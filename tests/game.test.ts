import assert from "node:assert/strict";

import { circleHitsWall } from "../src/lib/collision";
import { AVATAR_SPEED_PX_S, MazeGame } from "../src/lib/game";
import type { Maze, Vec } from "../src/lib/maze";

const CELL = 64;
const PLAYER_RADIUS = 8 / CELL;
const START_POINT = { x: CELL / 2, y: CELL / 2 };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGame(seed: number): MazeGame {
  const game = new MazeGame({ cols: 9, rows: 7, rng: seeded(seed) });
  game.setCellSize(CELL);
  game.enemies = [];
  return game;
}

function centerPx(cell: Vec): Vec {
  return { x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL };
}

function cellOfPx(point: Vec): Vec {
  return { x: Math.floor(point.x / CELL), y: Math.floor(point.y / CELL) };
}

/** Start, then place the pointer on the start marker until play begins. */
function begin(game: MazeGame, at = 1000): void {
  game.start();
  assert.equal(game.phase, "ready");
  game.movePointer(START_POINT.x, START_POINT.y, true, at);
  game.tick(0, at);
  assert.equal(game.phase, "playing");
}

/** Advance the clock in fixed ticks; returns the new "now". */
function run(game: MazeGame, from: number, durationMs: number, check?: (now: number) => void): number {
  let now = from;
  const end = from + durationMs;
  while (now < end) {
    const dt = Math.min(16, end - now);
    now += dt;
    game.tick(dt, now);
    check?.(now);
  }
  return now;
}

function assertAvatarClear(game: MazeGame, when: number): void {
  assert.equal(
    circleHitsWall(game.maze, { x: game.avatar.x / CELL, y: game.avatar.y / CELL }, PLAYER_RADIUS),
    false,
    `avatar entered a wall at ${when}ms`,
  );
}

function findWallPoint(game: MazeGame): Vec {
  for (let py = 1; py < CELL; py += 1) {
    for (let px = 1; px < CELL; px += 1) {
      if (circleHitsWall(game.maze, { x: px / CELL, y: py / CELL }, PLAYER_RADIUS)) {
        return { x: px, y: py };
      }
    }
  }
  throw new Error("no wall point found in the start cell");
}

function openMaze(cols: number, rows: number): Maze {
  const cells = Array.from({ length: cols * rows }, (_, index) => {
    const x = index % cols;
    const y = Math.floor(index / cols);
    return { n: y === 0, e: x === cols - 1, s: y === rows - 1, w: x === 0 };
  });
  return { cols, rows, cells, start: { x: 0, y: 0 }, exit: { x: cols - 1, y: rows - 1 } };
}

function findClosedEdge(maze: Maze): { a: Vec; b: Vec } {
  for (let y = 0; y < maze.rows; y += 1) {
    for (let x = 0; x < maze.cols; x += 1) {
      const cell = maze.cells[y * maze.cols + x];
      if (!cell) continue;
      if (cell.e && x + 1 < maze.cols) return { a: { x, y }, b: { x: x + 1, y } };
      if (cell.s && y + 1 < maze.rows) return { a: { x, y }, b: { x, y: y + 1 } };
    }
  }
  throw new Error("no closed edge found");
}

// 1. The avatar cannot cross a wall, even after five seconds of pursuit.
{
  const game = makeGame(11);
  begin(game, 1000);
  const edge = findClosedEdge(game.maze);
  game.avatar = centerPx(edge.a);
  game.movePointer(centerPx(edge.b).x, centerPx(edge.b).y, true, 1100);

  run(game, 1100, 5000, (now) => assertAvatarClear(game, now));
  assert.deepEqual(cellOfPx(game.avatar), edge.a, "avatar must stay on its side of the wall");
  assert.equal(game.phase, "playing");
}

// 2. A diagonal pointer pressed into a wall makes the avatar slide along it.
{
  const game = makeGame(12);
  begin(game, 1000);
  const startX = game.avatar.x;
  game.movePointer(CELL * 0.9, CELL * 0.02, true, 1100);

  run(game, 1100, 900, (now) => assertAvatarClear(game, now));
  assert.ok(game.avatar.x > startX + 8, "avatar should slide horizontally instead of freezing");
  assert.equal(cellOfPx(game.avatar).y, 0);
}

// 3. Ready phase: no time elapses before the pointer reaches the start cell.
{
  const game = makeGame(21);
  game.start();
  run(game, 1000, 1200);
  assert.equal(game.phase, "ready");
  assert.equal(game.elapsedMs, 0, "ready phase never advances the clock");

  game.movePointer(CELL * 1.5, CELL * 1.5, true, 2300);
  run(game, 2300, 500);
  assert.equal(game.phase, "ready", "a pointer outside the start cell does not start play");
  assert.equal(game.elapsedMs, 0);

  game.movePointer(START_POINT.x, START_POINT.y, true, 2900);
  game.tick(0, 2900);
  assert.equal(game.phase, "playing");
  assert.equal(game.elapsedMs, 0);
  game.tick(200, 3100);
  assert.equal(game.elapsedMs, 200);
}

// 4. Leaving the board while playing pauses with pointer-left and freezes time.
{
  const game = makeGame(31);
  begin(game, 1000);
  game.tick(200, 1200);
  assert.equal(game.elapsedMs, 200);

  game.movePointer(0, 0, false, 1300);
  assert.equal(game.phase, "paused");
  assert.equal(game.pauseReason, "pointer-left");
  game.tick(200, 1500);
  assert.equal(game.elapsedMs, 200, "paused time is not counted");

  game.resume(2000);
  assert.equal(game.phase, "playing");
  assert.equal(game.pauseReason, null);
  game.tick(200, 2200);
  assert.equal(game.elapsedMs, 400);
}

// 5. Invulnerability keeps its remaining time across a pause.
{
  const game = makeGame(41);
  const wall = findWallPoint(game);
  begin(game, 1000);

  game.movePointer(wall.x, wall.y, true, 1000);
  run(game, 1000, 1500);
  assert.equal(game.hearts, 3, "spawn protection holds while the wall is pressed");

  game.movePointer(START_POINT.x, START_POINT.y, true, 2500);
  game.tick(16, 2500);
  game.movePointer(wall.x, wall.y, true, 2600);
  run(game, 2600, 300);
  assert.equal(game.hearts, 2, "a contact after the grace period costs one heart");

  game.pause(2800);
  game.tick(200, 5000);
  assert.equal(game.hearts, 2);
  game.resume(5000);

  assert.equal(game.isInvulnerable(5700), true, "pause time is added to the deadline");
  assert.equal(game.isInvulnerable(5900), false);
}

// 6. One wall contact costs one heart, even while staying against the wall.
{
  const game = makeGame(51);
  const wall = findWallPoint(game);
  begin(game, 1000);
  game.movePointer(wall.x, wall.y, true, 1000);
  run(game, 1000, 1500);
  assert.equal(game.hearts, 3, "the spawn grace covers the first wall contact");

  game.movePointer(START_POINT.x, START_POINT.y, true, 2500);
  game.tick(16, 2500);
  game.movePointer(wall.x, wall.y, true, 2600);
  run(game, 2600, 300);
  assert.equal(game.hearts, 2);

  run(game, 2900, 2500);
  assert.equal(game.hearts, 2, "staying in a wall never drains a second heart");

  game.movePointer(START_POINT.x, START_POINT.y, true, 5400);
  game.tick(16, 5400);
  game.movePointer(wall.x, wall.y, true, 5500);
  run(game, 5500, 300);
  assert.equal(game.hearts, 1, "a new contact after a corridor costs one heart");
}

// 7. Non-regression: exit wins, enemy loses.
{
  const game = makeGame(61);
  begin(game, 1000);
  const exit = centerPx(game.maze.exit);
  game.avatar = { ...exit };
  game.movePointer(exit.x, exit.y, true, 1100);
  game.tick(16, 1100);
  assert.equal(game.phase, "won");
}
{
  const game = new MazeGame({ cols: 9, rows: 7, rng: seeded(62) });
  game.setCellSize(CELL);
  begin(game, 1000);
  const enemy = game.enemies[0];
  assert.ok(enemy);
  game.avatar = { x: enemy.pos.x * CELL, y: enemy.pos.y * CELL };
  game.movePointer(game.avatar.x, game.avatar.y, true, 1100);
  game.tick(16, 1100);
  assert.equal(game.phase, "lost");
  assert.equal(game.cause, "enemy");
}

// 8. A cell-size change must never leave the avatar inside a wall.
{
  const game = makeGame(71);
  game.avatar = { x: CELL / 2, y: 12.6 };
  assert.equal(
    circleHitsWall(game.maze, { x: game.avatar.x / CELL, y: game.avatar.y / CELL }, PLAYER_RADIUS),
    false,
  );
  game.setCellSize(56);
  assertAvatarClear(game, 0);
  assert.equal(Number.isFinite(game.avatar.x) && Number.isFinite(game.avatar.y), true);
}

// 9. Avatar speed is the documented constant.
{
  const game = makeGame(81);
  game.maze = openMaze(9, 7);
  begin(game, 1000);
  const target = { x: START_POINT.x + AVATAR_SPEED_PX_S * 0.1, y: START_POINT.y };
  game.movePointer(target.x, target.y, true, 1100);
  game.tick(100, 1100);
  assert.ok(Math.abs(game.avatar.x - target.x) < 0.001, "100 ms at 900 px/s moves 90 px");
}

console.log("game.test: avatar collisions, ready phase, auto-pause and regressions OK");
