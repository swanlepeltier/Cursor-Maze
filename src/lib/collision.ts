import type { Maze, Vec } from "./maze";

/** Wall thickness expressed as a fraction of one cell. */
export const WALL_THICKNESS = 0.14;

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function circleIntersectsRect(
  px: number,
  py: number,
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nearestX = Math.max(rx, Math.min(px, rx + rw));
  const nearestY = Math.max(ry, Math.min(py, ry + rh));
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Wall rectangles around one cell, in unit (cell) coordinates. Walls are
 * centred on cell borders and extend half a thickness past each corner so
 * that corners stay sealed.
 */
export function cellWallRects(cx: number, cy: number, cell: Maze["cells"][number]): WallRect[] {
  const t = WALL_THICKNESS;
  const half = t / 2;
  const rects: WallRect[] = [];

  if (cell.n) rects.push({ x: cx - half, y: cy - half, w: 1 + t, h: t });
  if (cell.s) rects.push({ x: cx - half, y: cy + 1 - half, w: 1 + t, h: t });
  if (cell.w) rects.push({ x: cx - half, y: cy - half, w: t, h: 1 + t });
  if (cell.e) rects.push({ x: cx + 1 - half, y: cy - half, w: t, h: 1 + t });

  return rects;
}

/**
 * True when a circle (in unit coordinates) overlaps any wall near it.
 * Only the 3x3 cell neighbourhood can possibly contain a wall within one
 * cell radius, which keeps this cheap enough to run every frame.
 */
export function circleHitsWall(maze: Maze, point: Vec, radius: number): boolean {
  const cx = Math.floor(point.x);
  const cy = Math.floor(point.y);

  for (let y = cy - 1; y <= cy + 1; y += 1) {
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) continue;
      const cell = maze.cells[y * maze.cols + x];
      if (!cell) continue;
      for (const rect of cellWallRects(x, y, cell)) {
        if (circleIntersectsRect(point.x, point.y, radius, rect.x, rect.y, rect.w, rect.h)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function cellOf(point: Vec): Vec {
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
}

export function isInCell(point: Vec, cell: Vec): boolean {
  return Math.floor(point.x) === cell.x && Math.floor(point.y) === cell.y;
}
