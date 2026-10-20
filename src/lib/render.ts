import { WALL_THICKNESS, cellWallRects } from "./collision";
import { ENEMY_RADIUS_UNITS, type Enemy } from "./enemies";
import type { Phase } from "./game";
import { PLAYER_RADIUS_PX } from "./game";
import { cellCenter, type Maze, type Vec } from "./maze";

const COLORS = {
  background: "#07090e",
  floor: "#0b0e15",
  floorAlt: "#0d1119",
  wall: "#252e42",
  wallEdge: "rgba(255, 255, 255, 0.075)",
  accent: "#5eead4",
  accentSoft: "rgba(94, 234, 212, 0.18)",
  danger: "#ff4d5f",
  dot: "rgba(148, 163, 184, 0.16)",
} as const;

export interface Scene {
  maze: Maze;
  cell: number;
  dpr: number;
  avatar: Vec;
  pointer: Vec | null;
  enemies: Enemy[];
  phase: Phase;
  invulnerable: boolean;
  lastHitAt: number;
  now: number;
  reducedMotion: boolean;
}

export function scenePadding(cell: number): number {
  return Math.ceil(cell * (WALL_THICKNESS / 2));
}

interface Layer {
  maze: Maze;
  cell: number;
  dpr: number;
  canvas: HTMLCanvasElement;
}

const layers = new WeakMap<HTMLCanvasElement, Layer>();

function buildLayer(maze: Maze, cell: number, dpr: number, pad: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((maze.cols * cell + pad * 2) * dpr);
  canvas.height = Math.round((maze.rows * cell + pad * 2) * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, maze.cols * cell + pad * 2, maze.rows * cell + pad * 2);
  ctx.translate(pad, pad);

  for (let y = 0; y < maze.rows; y += 1) {
    for (let x = 0; x < maze.cols; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
      ctx.fillRect(x * cell, y * cell, cell, cell);

      const center = cellCenter({ x, y });
      ctx.beginPath();
      ctx.arc(center.x * cell, center.y * cell, Math.max(1, cell * 0.012), 0, Math.PI * 2);
      ctx.fillStyle = COLORS.dot;
      ctx.fill();
    }
  }

  const exitX = maze.exit.x * cell;
  const exitY = maze.exit.y * cell;
  ctx.beginPath();
  ctx.roundRect(exitX + cell * 0.12, exitY + cell * 0.12, cell * 0.76, cell * 0.76, cell * 0.16);
  ctx.fillStyle = COLORS.accentSoft;
  ctx.fill();
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = Math.max(1.5, cell * 0.035);
  ctx.stroke();

  const bracket = cell * 0.2;
  const inset = cell * 0.26;
  ctx.strokeStyle = "rgba(94, 234, 212, 0.75)";
  ctx.lineWidth = Math.max(1.2, cell * 0.022);
  ctx.lineCap = "round";
  const corners: Array<[number, number, number, number]> = [
    [exitX + inset, exitY + inset + bracket, exitX + inset, exitY + inset],
    [exitX + inset, exitY + inset, exitX + inset + bracket, exitY + inset],
    [exitX + cell - inset - bracket, exitY + cell - inset, exitX + cell - inset, exitY + cell - inset],
    [exitX + cell - inset, exitY + cell - inset, exitX + cell - inset, exitY + cell - inset - bracket],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  for (let y = 0; y < maze.rows; y += 1) {
    for (let x = 0; x < maze.cols; x += 1) {
      const cellWalls = maze.cells[y * maze.cols + x];
      if (!cellWalls) continue;
      for (const rect of cellWallRects(x, y, cellWalls)) {
        const rx = rect.x * cell;
        const ry = rect.y * cell;
        const rw = rect.w * cell;
        const rh = rect.h * cell;
        const radius = Math.min(3, Math.min(rw, rh) / 2);

        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, radius);
        ctx.fillStyle = COLORS.wall;
        ctx.fill();
        ctx.strokeStyle = COLORS.wallEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  return canvas;
}

function ensureLayer(canvas: HTMLCanvasElement, maze: Maze, cell: number, dpr: number): HTMLCanvasElement {
  const pad = scenePadding(cell);
  const cached = layers.get(canvas);
  if (cached && cached.maze === maze && cached.cell === cell && cached.dpr === dpr) {
    return cached.canvas;
  }
  const layer = buildLayer(maze, cell, dpr, pad);
  layers.set(canvas, { maze, cell, dpr, canvas: layer });
  return layer;
}

export function drawScene(canvas: HTMLCanvasElement, scene: Scene): void {
  const { maze, cell, dpr, now, reducedMotion } = scene;
  const pad = scenePadding(cell);
  const cssWidth = maze.cols * cell + pad * 2;
  const cssHeight = maze.rows * cell + pad * 2;
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(ensureLayer(canvas, maze, cell, dpr), 0, 0, cssWidth, cssHeight);
  ctx.translate(pad, pad);

  const exit = cellCenter(maze.exit);
  const exitX = exit.x * cell;
  const exitY = exit.y * cell;
  const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);

  const halo = ctx.createRadialGradient(exitX, exitY, cell * 0.05, exitX, exitY, cell * (0.5 + pulse * 0.18));
  halo.addColorStop(0, `rgba(94, 234, 212, ${0.22 + pulse * 0.12})`);
  halo.addColorStop(0.55, "rgba(94, 234, 212, 0.08)");
  halo.addColorStop(1, "rgba(94, 234, 212, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(exitX, exitY, cell * 0.75, 0, Math.PI * 2);
  ctx.fill();

  for (const enemy of scene.enemies) {
    const ex = enemy.pos.x * cell;
    const ey = enemy.pos.y * cell;
    const radius = Math.max(4, ENEMY_RADIUS_UNITS * cell);
    const glow = ctx.createRadialGradient(ex, ey, radius * 0.2, ex, ey, radius * 3);
    glow.addColorStop(0, "rgba(255, 77, 95, 0.55)");
    glow.addColorStop(0.45, "rgba(255, 77, 95, 0.16)");
    glow.addColorStop(1, "rgba(255, 77, 95, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ex, ey, radius * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex, ey, radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.danger;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex - radius * 0.3, ey - radius * 0.3, radius * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fill();
  }

  if (scene.phase === "ready") {
    const start = cellCenter(maze.start);
    const sx = start.x * cell;
    const sy = start.y * cell;
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 380);
    ctx.save();
    ctx.setLineDash([cell * 0.09, cell * 0.07]);
    ctx.lineDashOffset = reducedMotion ? 0 : -now / 55;
    ctx.strokeStyle = `rgba(94, 234, 212, ${0.5 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, cell * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const pointerX = scene.pointer?.x ?? null;
  const pointerY = scene.pointer?.y ?? null;

  if (pointerX !== null && pointerY !== null) {
    const gap = Math.hypot(pointerX - scene.avatar.x, pointerY - scene.avatar.y);
    if (gap > 6) {
      ctx.strokeStyle = "rgba(94, 234, 212, 0.6)";
      ctx.lineWidth = 1.5;
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const inner = 5;
        const outer = 9;
        ctx.beginPath();
        ctx.moveTo(pointerX + Math.cos(angle) * inner, pointerY + Math.sin(angle) * inner);
        ctx.lineTo(pointerX + Math.cos(angle) * outer, pointerY + Math.sin(angle) * outer);
        ctx.stroke();
      }
    }
  }

  if (scene.phase !== "idle") {
    const px = scene.avatar.x;
    const py = scene.avatar.y;
    const blink = scene.invulnerable && !reducedMotion ? 0.45 + 0.4 * Math.sin(now / 45) : 1;
    const radius = PLAYER_RADIUS_PX;
    const gap = pointerX !== null && pointerY !== null ? Math.hypot(pointerX - px, pointerY - py) : Infinity;
    const separation = Number.isFinite(gap) ? Math.min(1, gap / (cell * 0.45)) : 1;

    ctx.globalAlpha = (0.6 + 0.4 * separation) * blink;

    const ringGlow = ctx.createRadialGradient(px, py, radius * 0.6, px, py, radius * 2.6);
    ringGlow.addColorStop(0, "rgba(94, 234, 212, 0.35)");
    ringGlow.addColorStop(1, "rgba(94, 234, 212, 0)");
    ctx.fillStyle = ringGlow;
    ctx.beginPath();
    ctx.arc(px, py, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent;
    ctx.fill();

    ctx.strokeStyle = "rgba(94, 234, 212, 0.55)";
    ctx.lineWidth = 1.5;
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const inner = radius + 3;
      const outer = radius + 7;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(angle) * inner, py + Math.sin(angle) * inner);
      ctx.lineTo(px + Math.cos(angle) * outer, py + Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  const sinceHit = now - scene.lastHitAt;
  if (sinceHit >= 0 && sinceHit < 380) {
    const strength = (1 - sinceHit / 380) * 0.55;
    const vignette = ctx.createRadialGradient(
      cssWidth / 2 - pad,
      cssHeight / 2 - pad,
      Math.min(cssWidth, cssHeight) * 0.18,
      cssWidth / 2 - pad,
      cssHeight / 2 - pad,
      Math.max(cssWidth, cssHeight) * 0.62,
    );
    vignette.addColorStop(0, "rgba(255, 77, 95, 0)");
    vignette.addColorStop(1, `rgba(255, 77, 95, ${strength})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(-pad, -pad, cssWidth, cssHeight);
  }
}
