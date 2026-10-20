import assert from "node:assert/strict";

import { circleHitsWall } from "../src/lib/collision";
import { MazeGame } from "../src/lib/game";

const CELL = 64;
const PLAYER_RADIUS = 8 / CELL;

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

function findWallPoint(game: MazeGame): { x: number; y: number } {
  for (let py = 1; py < CELL; py += 1) {
    for (let px = 1; px < CELL; px += 1) {
      if (circleHitsWall(game.maze, { x: px / CELL, y: py / CELL }, PLAYER_RADIUS)) {
        return { x: px, y: py };
      }
    }
  }
  throw new Error("no wall point found in the start cell");
}

function tick(game: MazeGame, at: number, dt = 16): void {
  game.tick(dt, at);
}

// 1. Spawn grace: landing in a wall right after start/restart must not damage.
{
  const game = makeGame(1);
  const wall = findWallPoint(game);
  const corridor = { x: CELL / 2, y: CELL / 2 };

  game.start();
  game.movePointer(wall.x, wall.y, true);
  for (const at of [1000, 1600, 2100, 3000]) tick(game, at);
  assert.equal(game.hearts, 3, "spawn contact must not remove a heart");

  game.movePointer(corridor.x, corridor.y, true);
  tick(game, 3100);
  assert.equal(game.hearts, 3, "crossing a corridor is safe");

  game.movePointer(wall.x, wall.y, true);
  tick(game, 3200);
  assert.equal(game.hearts, 2, "a wall hit after a corridor costs one heart");

  tick(game, 4000);
  tick(game, 6000);
  assert.equal(game.hearts, 2, "staying inside a wall never costs a second heart");

  game.movePointer(corridor.x, corridor.y, true);
  tick(game, 6100);
  game.movePointer(wall.x, wall.y, true);
  tick(game, 6200);
  assert.equal(game.hearts, 1, "a new contact after invulnerability costs one heart");

  game.restart();
  game.movePointer(wall.x, wall.y, true);
  tick(game, 7000);
  tick(game, 9000);
  assert.equal(game.hearts, 3, "restart while inside a wall restores spawn grace");
}

// 2. Elapsed time follows real time in 200 ms steps, but never while paused.
{
  const game = makeGame(2);
  game.start();
  game.movePointer(CELL / 2, CELL / 2, true);

  tick(game, 1000, 200);
  assert.equal(game.elapsedMs, 200);
  tick(game, 1200, 200);
  assert.equal(game.elapsedMs, 400);

  game.pause(1250);
  tick(game, 1500, 200);
  assert.equal(game.elapsedMs, 400, "paused frames do not advance the clock");

  game.resume(2000);
  tick(game, 2200, 200);
  assert.equal(game.elapsedMs, 600);
}

// 3. Invulnerability keeps its remaining time across a pause.
{
  const game = makeGame(3);
  const wall = findWallPoint(game);
  game.start();
  game.movePointer(CELL / 2, CELL / 2, true);
  tick(game, 1000);

  game.movePointer(wall.x, wall.y, true);
  tick(game, 2600, 1600);
  assert.equal(game.hearts, 2);

  game.pause(3000);
  tick(game, 4000, 200);
  game.resume(5000);

  assert.equal(game.isInvulnerable(5500), true, "pause time is added to the deadline");
  assert.equal(game.isInvulnerable(5700), false);
  assert.equal(game.hearts, 2);
}

console.log("game.test: spawn grace, real-time clock and pause-safe invulnerability OK");
