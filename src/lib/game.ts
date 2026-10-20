import { circleHitsWall, distance, isInCell } from "./collision";
import { ENEMY_RADIUS_UNITS, createEnemies, stepEnemies, type Enemy } from "./enemies";
import { cellCenter, generateMaze, type Maze, type Rng, type Vec } from "./maze";

export type Phase = "idle" | "playing" | "paused" | "won" | "lost";
export type LoseCause = "hearts" | "enemy";

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

export class MazeGame {
  readonly cols: number;
  readonly rows: number;

  maze: Maze;
  enemies: Enemy[];
  phase: Phase = "idle";
  hearts = MAX_HEARTS;
  level = 1;
  attempts = 1;
  elapsedMs = 0;
  cause: LoseCause | null = null;
  player: Vec;
  pointerInside = false;
  cellSizePx = 64;
  lastHitAt = Number.NEGATIVE_INFINITY;

  private readonly rng: Rng;
  private readonly onEvent: (event: GameEvent) => void;
  private invulnerableUntil = 0;
  private wallContact = false;
  /** Wall damage stays disabled until the pointer has reached a corridor once. */
  private corridorSeen = false;
  /** First tick after a (re)start arms the spawn protection. */
  private armedAt: number | null = null;
  private pausedAt: number | null = null;

  constructor({ cols, rows, rng = Math.random, onEvent }: GameOptions) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.onEvent = onEvent ?? (() => {});
    this.maze = generateMaze(cols, rows, rng);
    this.enemies = createEnemies(this.maze, this.level, rng);
    this.player = cellCenter(this.maze.start);
  }

  private rebuild(level: number, attempts: number): void {
    this.level = level;
    this.attempts = attempts;
    this.maze = generateMaze(this.cols, this.rows, this.rng);
    this.enemies = createEnemies(this.maze, level, this.rng);
    this.hearts = MAX_HEARTS;
    this.elapsedMs = 0;
    this.cause = null;
    this.player = cellCenter(this.maze.start);
    this.pointerInside = false;
    this.wallContact = false;
    this.corridorSeen = false;
    this.armedAt = null;
    this.pausedAt = null;
    this.invulnerableUntil = 0;
    this.lastHitAt = Number.NEGATIVE_INFINITY;
  }

  start(): void {
    if (this.phase !== "idle") return;
    this.corridorSeen = false;
    this.armedAt = null;
    this.phase = "playing";
    this.onEvent("start");
  }

  restart(): void {
    this.rebuild(this.level, this.attempts + 1);
    this.phase = "playing";
    this.onEvent("restart");
  }

  nextLevel(): void {
    this.rebuild(this.level + 1, this.attempts);
    this.phase = "playing";
    this.onEvent("next-level");
  }

  pause(now: number): void {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.pausedAt = now;
    this.onEvent("pause");
  }

  resume(now: number): void {
    if (this.phase !== "paused") return;
    if (this.pausedAt !== null) {
      const pausedFor = Math.max(0, now - this.pausedAt);
      if (Number.isFinite(this.invulnerableUntil)) this.invulnerableUntil += pausedFor;
      if (Number.isFinite(this.lastHitAt)) this.lastHitAt += pausedFor;
    }
    this.pausedAt = null;
    this.phase = "playing";
    this.onEvent("resume");
  }

  setCellSize(px: number): void {
    if (px > 0) this.cellSizePx = px;
  }

  /** Pointer position in board pixels, relative to the maze canvas. */
  movePointer(x: number, y: number, inside: boolean): void {
    this.pointerInside = inside;
    if (!inside) return;
    this.player = {
      x: Math.min(this.cols - 0.001, Math.max(0, x / this.cellSizePx)),
      y: Math.min(this.rows - 0.001, Math.max(0, y / this.cellSizePx)),
    };
  }

  private playerRadiusUnits(): number {
    return PLAYER_RADIUS_PX / this.cellSizePx;
  }

  tick(dtMs: number, now: number): void {
    if (this.phase !== "playing") return;

    if (this.armedAt === null) {
      this.armedAt = now;
      this.invulnerableUntil = Math.max(this.invulnerableUntil, now + INVULNERABILITY_MS);
    }

    this.elapsedMs += dtMs;
    stepEnemies(this.enemies, this.maze, Math.min(ENEMY_STEP_MS, dtMs) / 1000, this.cellSizePx, this.rng);

    if (!this.pointerInside) return;

    if (isInCell(this.player, this.maze.exit)) {
      this.phase = "won";
      this.onEvent("win");
      return;
    }

    const hitRadius = this.playerRadiusUnits() + ENEMY_RADIUS_UNITS;
    for (const enemy of this.enemies) {
      if (distance(this.player, enemy.pos) < hitRadius) {
        this.phase = "lost";
        this.cause = "enemy";
        this.onEvent("enemy");
        this.onEvent("lose");
        return;
      }
    }

    const touching = circleHitsWall(this.maze, this.player, this.playerRadiusUnits());
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
