import { cellCenter, cellIndex, distanceField, openNeighbors, type Maze, type Rng, type Vec } from "./maze";

export interface Enemy {
  /** Position in unit (cell) coordinates. */
  pos: Vec;
  /** Cell the enemy is currently walking towards. */
  target: Vec;
  /** Cell it came from, used to avoid instant backtracking. */
  previous: Vec;
  /** Pixels per second. */
  speed: number;
}

export const MAX_ENEMIES = 6;
export const ENEMY_RADIUS_UNITS = 0.16;

export function enemyCount(level: number): number {
  return Math.min(MAX_ENEMIES, 2 + Math.floor(level / 2));
}

function pick<T>(items: T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** Spawn cells: at least two graph steps from the start, never on the exit. */
export function spawnCells(maze: Maze, level: number, rng: Rng = Math.random): Vec[] {
  const distances = distanceField(maze, maze.start);
  const candidates: Vec[] = [];

  for (let y = 0; y < maze.rows; y += 1) {
    for (let x = 0; x < maze.cols; x += 1) {
      if (x === maze.exit.x && y === maze.exit.y) continue;
      if (x === maze.start.x && y === maze.start.y) continue;
      const distance = distances[cellIndex(maze, x, y)] ?? -1;
      if (distance < 2) continue;
      candidates.push({ x, y });
    }
  }

  const chosen: Vec[] = [];
  const wanted = Math.min(enemyCount(level), candidates.length);

  while (chosen.length < wanted) {
    const candidate = pick(candidates, rng);
    if (!candidate) break;
    const already = chosen.some((cell) => cell.x === candidate.x && cell.y === candidate.y);
    if (!already) chosen.push(candidate);
  }

  return chosen;
}

export function createEnemies(maze: Maze, level: number, rng: Rng = Math.random): Enemy[] {
  return spawnCells(maze, level, rng).map((cell) => {
    const neighbors = openNeighbors(maze, cell).filter(
      (entry) => !(entry.cell.x === maze.exit.x && entry.cell.y === maze.exit.y),
    );
    const next = pick(neighbors, rng) ?? pick(openNeighbors(maze, cell), rng);
    return {
      pos: cellCenter(cell),
      previous: cell,
      target: next ? next.cell : cell,
      speed: 70 + rng() * 40,
    };
  });
}

function chooseNext(maze: Maze, enemy: Enemy, rng: Rng, cell: Vec): Vec {
  const options = openNeighbors(maze, cell);
  const forward = options.filter(
    (entry) =>
      !(entry.cell.x === enemy.previous.x && entry.cell.y === enemy.previous.y) &&
      !(entry.cell.x === maze.exit.x && entry.cell.y === maze.exit.y),
  );
  const fallback = options.filter(
    (entry) => !(entry.cell.x === maze.exit.x && entry.cell.y === maze.exit.y),
  );
  const next = pick(forward, rng) ?? pick(fallback, rng) ?? pick(options, rng);
  return next ? next.cell : cell;
}

/**
 * Advance one enemy along the corridor graph. Movement is always between the
 * centres of two adjacent open cells, so enemies never cross a wall.
 */
export function stepEnemy(
  enemy: Enemy,
  maze: Maze,
  dtSeconds: number,
  cellSizePx: number,
  rng: Rng = Math.random,
): void {
  let remaining = (enemy.speed / Math.max(1, cellSizePx)) * dtSeconds;
  let guard = 0;

  while (remaining > 0 && guard < 8) {
    guard += 1;
    const targetCenter = cellCenter(enemy.target);
    const dx = targetCenter.x - enemy.pos.x;
    const dy = targetCenter.y - enemy.pos.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= remaining || distance < 1e-6) {
      enemy.pos = targetCenter;
      remaining -= distance;
      enemy.previous = { x: Math.floor(targetCenter.x), y: Math.floor(targetCenter.y) };
      enemy.target = chooseNext(maze, enemy, rng, enemy.previous);
      continue;
    }

    enemy.pos = {
      x: enemy.pos.x + (dx / distance) * remaining,
      y: enemy.pos.y + (dy / distance) * remaining,
    };
    remaining = 0;
  }
}

export function stepEnemies(
  enemies: Enemy[],
  maze: Maze,
  dtSeconds: number,
  cellSizePx: number,
  rng: Rng = Math.random,
): void {
  for (const enemy of enemies) {
    stepEnemy(enemy, maze, dtSeconds, cellSizePx, rng);
  }
}
