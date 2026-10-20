export interface Vec {
  x: number;
  y: number;
}

export type Direction = "n" | "e" | "s" | "w";

export interface Cell {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

export interface Maze {
  cols: number;
  rows: number;
  cells: Cell[];
  start: Vec;
  exit: Vec;
}

export type Rng = () => number;

export const OPPOSITE: Record<Direction, Direction> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

const DIRS: ReadonlyArray<{ dir: Direction; dx: number; dy: number }> = [
  { dir: "n", dx: 0, dy: -1 },
  { dir: "e", dx: 1, dy: 0 },
  { dir: "s", dx: 0, dy: 1 },
  { dir: "w", dx: -1, dy: 0 },
];

export function cellIndex(maze: Pick<Maze, "cols">, x: number, y: number): number {
  return y * maze.cols + x;
}

export function cellAt(maze: Maze, x: number, y: number): Cell | undefined {
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return undefined;
  return maze.cells[cellIndex(maze, x, y)];
}

export function cellCenter(cell: Vec): Vec {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

export function inBounds(maze: Pick<Maze, "cols" | "rows">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < maze.cols && y < maze.rows;
}

export function openNeighbors(maze: Maze, from: Vec): Array<{ cell: Vec; dir: Direction }> {
  const cell = cellAt(maze, from.x, from.y);
  if (!cell) return [];
  const result: Array<{ cell: Vec; dir: Direction }> = [];
  for (const { dir, dx, dy } of DIRS) {
    if (cell[dir]) continue;
    const x = from.x + dx;
    const y = from.y + dy;
    if (inBounds(maze, x, y)) result.push({ cell: { x, y }, dir });
  }
  return result;
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return items;
}

function carve(a: Cell, dir: Direction): void {
  a[dir] = false;
}

/**
 * Perfect maze via iterative recursive backtracker. Every cell is reachable
 * from every other cell, so the exit is always solvable. Dimensions are
 * expected to be odd, which keeps a wall ring around the board.
 */
export function generateMaze(cols: number, rows: number, rng: Rng = Math.random): Maze {
  if (cols < 5 || rows < 5) {
    throw new Error("Maze dimensions must be at least 5x5");
  }

  const cells: Cell[] = Array.from({ length: cols * rows }, () => ({
    n: true,
    e: true,
    s: true,
    w: true,
  }));

  const visited = new Uint8Array(cols * rows);
  const start: Vec = { x: 0, y: 0 };
  const stack: Vec[] = [start];
  visited[cellIndex({ cols }, start.x, start.y)] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (!current) break;

    const options = DIRS.flatMap(({ dir, dx, dy }) => {
      const x = current.x + dx;
      const y = current.y + dy;
      if (!inBounds({ cols, rows }, x, y)) return [];
      if (visited[y * cols + x]) return [];
      return [{ dir, x, y }];
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const pick = shuffled(options, rng)[0];
    if (!pick) break;

    const from = cells[current.y * cols + current.x];
    const to = cells[pick.y * cols + pick.x];
    if (!from || !to) break;

    carve(from, pick.dir);
    carve(to, OPPOSITE[pick.dir]);

    visited[pick.y * cols + pick.x] = 1;
    stack.push({ x: pick.x, y: pick.y });
  }

  return {
    cols,
    rows,
    cells,
    start,
    exit: { x: cols - 1, y: rows - 1 },
  };
}

/** Breadth-first step distance from a cell; -1 when unreachable. */
export function distanceField(maze: Maze, from: Vec): Int32Array {
  const field = new Int32Array(maze.cols * maze.rows).fill(-1);
  if (!inBounds(maze, from.x, from.y)) return field;

  field[cellIndex(maze, from.x, from.y)] = 0;
  const queue: Vec[] = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (!current) continue;
    const distance = field[cellIndex(maze, current.x, current.y)] ?? 0;
    for (const { cell } of openNeighbors(maze, current)) {
      const idx = cellIndex(maze, cell.x, cell.y);
      if (field[idx] !== -1) continue;
      field[idx] = distance + 1;
      queue.push(cell);
    }
  }

  return field;
}

export function isReachable(maze: Maze, target: Vec): boolean {
  const field = distanceField(maze, maze.start);
  return field[cellIndex(maze, target.x, target.y)] !== -1;
}
