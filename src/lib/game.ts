import { cellOf, circleHitsWall, distance, isInCell } from "./collision";
import { ENEMY_RADIUS_UNITS, createEnemies, stepEnemies, type Enemy } from "./enemies";
import { cellCenter, generateMaze, type Maze, type Rng, type Vec } from "./maze";

export type Phase = "idle" | "ready" | "playing" | "paused" | "won" | "lost";
export type LoseCause = "hearts" | "enemy";
export type PauseReason = "manual" | "pointer-left";

export type GameEvent =
  | "start"
  | "wall"
  | "heart"
  | "enemy"
  | "win"
  | "lose"
  | "restart"
  | "next-level"
  | "pause"
  | "resume";

export interface GameOptions {
  cols: number;
  rows: number;
  rng?: Rng;
  onEvent?: (event: GameEvent) => void;
}

export const MAX_HEARTS = 3;
export const PLAYER_RADIUS_PX = 8;
export const INVULNERABILITY_MS = 1000;
/** Enemies keep a short, stable physics step even when a frame arrives late. */
export const ENEMY_STEP_MS = 48;
/** The avatar follows the pointer instead of teleporting to it. */
export const AVATAR_SPEED_PX_S = 900;
export const AVATAR_SNAP_PX = 3;
/** Maximum distance travelled per collision test (half the collision radius). */
export const AVATAR_SUBSTEP_PX = PLAYER_RADIUS_PX / 2;
/** Extra probe radius so pressing or grazing a wall still counts as contact. */
export const WALL_CONTACT_EPS_PX = AVATAR_SUBSTEP_PX;

export class MazeGame {
  readonly cols: number;
  readonly rows: number;

  maze: Maze;
  enemies: Enemy[];
  phase: Phase = "idle";
  pauseReason: PauseReason | null = null;
  hearts = MAX_HEARTS;
  level = 1;
  attempts = 1;
  elapsedMs = 0;
  cause: LoseCause | null = null;
  /** Player-controlled target, in board pixels. Null while outside the board. */
  pointer: Vec | null = null;
  /** Collision body pursuit position, in board pixels. */
  avatar: Vec;
  pointerInside = false;
  cellSizePx = 64;
  lastHitAt = Number.NEGATIVE_INFINITY;

  private readonly rng: Rng;
  private readonly onEvent: (event: GameEvent) => void;
  private invulnerableUntil = 0;
  private wallContact = false;
  /** Wall damage stays disabled until the avatar has reached a corridor once. */
  private corridorSeen = false;
  /** First tick of play arms the spawn protection. */
  private armedAt: number | null = null;
  private pausedAt: number | null = null;

  constructor({ cols, rows, rng = Math.random, onEvent }: GameOptions) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.onEvent = onEvent ?? (() => {});
    this.maze = generateMaze(cols, rows, rng);
    this.enemies = createEnemies(this.maze, this.level, rng);
    this.avatar = this.centerOf(this.maze.start);
  }

  private centerOf(cell: Vec): Vec {
    const center = cellCenter(cell);
    return { x: center.x * this.cellSizePx, y: center.y * this.cellSizePx };
  }

  private rebuild(level: number, attempts: number): void {
    this.level = level;
    this.attempts = attempts;
    this.maze = generateMaze(this.cols, this.rows, this.rng);
    this.enemies = createEnemies(this.maze, level, this.rng);
    this.hearts = MAX_HEARTS;
    this.elapsedMs = 0;
    this.cause = null;
    this.avatar = this.centerOf(this.maze.start);
    this.pointer = null;
    this.pointerInside = false;
    this.pauseReason = null;
    this.wallContact = false;
    this.corridorSeen = false;
    this.armedAt = null;
    this.pausedAt = null;
    this.invulnerableUntil = 0;
    this.lastHitAt = Number.NEGATIVE_INFINITY;
  }

  /** Leaves idle for the ready phase; play only starts on the start marker. */
  start(): void {
    if (this.phase !== "idle") return;
    this.corridorSeen = false;
    this.armedAt = null;
    this.phase = "ready";
    this.onEvent("start");
  }

  restart(): void {
    this.rebuild(this.level, this.attempts + 1);
    this.phase = "ready";
    this.onEvent("restart");
  }

  nextLevel(): void {
    this.rebuild(this.level + 1, this.attempts);
    this.phase = "ready";
    this.onEvent("next-level");
  }

  pause(now: number, reason: PauseReason = "manual"): void {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.pauseReason = reason;
    this.pausedAt = now;
    this.onEvent("pause");
  }

  resume(now: number): void {
    if (this.phase !== "paused") return;
    if (!this.pointer) {
      this.pauseReason = "pointer-left";
      return;
    }
    if (this.pausedAt !== null) {
      const pausedFor = Math.max(0, now - this.pausedAt);
      if (Number.isFinite(this.invulnerableUntil)) this.invulnerableUntil += pausedFor;
      if (Number.isFinite(this.lastHitAt)) this.lastHitAt += pausedFor;
    }
    this.pausedAt = null;
    this.pauseReason = null;
    this.phase = "playing";
    this.onEvent("resume");
  }

  setCellSize(px: number): void {
    if (px <= 0 || px === this.cellSizePx) return;
    const scale = px / this.cellSizePx;
    this.avatar = { x: this.avatar.x * scale, y: this.avatar.y * scale };
    if (this.pointer) {
      this.pointer = { x: this.pointer.x * scale, y: this.pointer.y * scale };
    }
    this.cellSizePx = px;
    this.ensureAvatarClear();
  }

  /** Pointer position in board pixels, relative to the maze canvas. */
  movePointer(x: number, y: number, inside: boolean, now: number = performance.now()): void {
    if (!inside) {
      this.pointer = null;
      this.pointerInside = false;
      if (this.phase === "playing") this.pause(now, "pointer-left");
      return;
    }

    const boardWidth = this.cols * this.cellSizePx;
    const boardHeight = this.rows * this.cellSizePx;
    this.pointer = {
      x: Math.min(boardWidth - 0.001, Math.max(0, x)),
      y: Math.min(boardHeight - 0.001, Math.max(0, y)),
    };
    this.pointerInside = true;
  }

  private radiusUnits(): number {
    return PLAYER_RADIUS_PX / this.cellSizePx;
  }

  private toUnits(point: Vec): Vec {
    return { x: point.x / this.cellSizePx, y: point.y / this.cellSizePx };
  }

  private hitsWall(point: Vec, extraRadiusPx = 0): boolean {
    return circleHitsWall(
      this.maze,
      this.toUnits(point),
      this.radiusUnits() + extraRadiusPx / this.cellSizePx,
    );
  }

  private pointerCell(): Vec | null {
    if (!this.pointer) return null;
    return cellOf(this.toUnits(this.pointer));
  }

  private ensureAvatarClear(): void {
    if (!this.hitsWall(this.avatar)) return;
    const unit = this.toUnits(this.avatar);
    const x = Math.max(0, Math.min(this.cols - 1, Math.floor(unit.x)));
    const y = Math.max(0, Math.min(this.rows - 1, Math.floor(unit.y)));
    this.avatar = this.centerOf({ x, y });
    if (this.hitsWall(this.avatar)) this.avatar = this.centerOf(this.maze.start);
  }

  private tryStep(dx: number, dy: number): boolean {
    const next = { x: this.avatar.x + dx, y: this.avatar.y + dy };
    const boardWidth = this.cols * this.cellSizePx;
    const boardHeight = this.rows * this.cellSizePx;
    if (next.x < 0 || next.y < 0 || next.x >= boardWidth || next.y >= boardHeight) return false;
    if (this.hitsWall(next)) return false;
    this.avatar = next;
    return true;
  }

  /**
   * Move the avatar towards the pointer with fixed-size substeps. A blocked
   * diagonal falls back to one axis at a time so the body slides along walls.
   */
  private stepAvatar(dtMs: number): void {
    const pointer = this.pointer;
    if (!pointer) return;

    const gap = distance(this.avatar, pointer);
    const pointerCell = this.pointerCell();
    const avatarCell = cellOf(this.toUnits(this.avatar));
    if (
      gap <= AVATAR_SNAP_PX &&
      pointerCell &&
      isInCell(pointerCell, avatarCell) &&
      !this.hitsWall(pointer)
    ) {
      this.avatar = { x: pointer.x, y: pointer.y };
      return;
    }

    if (gap <= 0) return;

    const travel = Math.min(gap, (AVATAR_SPEED_PX_S * dtMs) / 1000);
    if (travel <= 0) return;

    const steps = Math.max(1, Math.ceil(travel / AVATAR_SUBSTEP_PX));
    const step = travel / steps;
    const ux = ((pointer.x - this.avatar.x) / gap) * step;
    const uy = ((pointer.y - this.avatar.y) / gap) * step;

    for (let index = 0; index < steps; index += 1) {
      if (this.tryStep(ux, uy)) continue;
      const movedX = this.tryStep(ux, 0);
      const movedY = this.tryStep(0, uy);
      if (!movedX && !movedY) break;
    }
  }

  tick(dtMs: number, now: number): void {
    if (this.phase === "ready") {
      const pointerCell = this.pointerCell();
      if (!pointerCell || !isInCell(pointerCell, this.maze.start)) return;
      this.phase = "playing";
      this.armedAt = null;
      return;
    }
    if (this.phase !== "playing") return;
    if (!this.pointer) {
      this.pause(now, "pointer-left");
      return;
    }

    if (this.armedAt === null) {
      this.armedAt = now;
      this.invulnerableUntil = Math.max(this.invulnerableUntil, now + INVULNERABILITY_MS);
    }

    this.elapsedMs += dtMs;
    stepEnemies(this.enemies, this.maze, Math.min(ENEMY_STEP_MS, dtMs) / 1000, this.cellSizePx, this.rng);
    this.stepAvatar(dtMs);

    const avatarUnits = this.toUnits(this.avatar);

    if (isInCell(avatarUnits, this.maze.exit)) {
      this.phase = "won";
      this.onEvent("win");
      return;
    }

    const hitRadius = this.radiusUnits() + ENEMY_RADIUS_UNITS;
    for (const enemy of this.enemies) {
      if (distance(avatarUnits, enemy.pos) < hitRadius) {
        this.phase = "lost";
        this.cause = "enemy";
        this.onEvent("enemy");
        this.onEvent("lose");
        return;
      }
    }

    const touching = circleHitsWall(
      this.maze,
      avatarUnits,
      this.radiusUnits() + WALL_CONTACT_EPS_PX / this.cellSizePx,
    );
    if (!touching) {
      this.corridorSeen = true;
      this.wallContact = false;
      return;
    }

    if (!this.wallContact) {
      this.wallContact = true;
      if (this.corridorSeen && now >= this.invulnerableUntil) this.damage(now);
    }
  }

  private damage(now: number): void {
    this.hearts = Math.max(0, this.hearts - 1);
    this.invulnerableUntil = now + INVULNERABILITY_MS;
    this.lastHitAt = now;
    this.onEvent("wall");
    this.onEvent("heart");

    if (this.hearts === 0) {
      this.phase = "lost";
      this.cause = "hearts";
      this.onEvent("lose");
    }
  }

  isInvulnerable(now: number): boolean {
    return now < this.invulnerableUntil;
  }
}
