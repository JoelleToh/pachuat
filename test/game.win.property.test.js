// test/game.win.property.test.js
//
// Property-based test for the win transition on the Game simulation hub
// (task 9.14).
//
// Covers design Property 19 "Clearing all collectibles wins the game": for all
// consumption sequences that reduce the combined remaining pellets + power
// pellets to 0, the game mode becomes 'won'. The win edge lives in
// Game.update(): after the player moves and consumes any collectible on its
// tile, the game transitions to 'won' as soon as
// maze.remainingCollectibles() === 0.
//
// Strategy: build a Game and start it, then drive the maze toward a cleared
// state deterministically. For an arbitrary final collectible tile, every
// OTHER collectible is removed directly from game.maze (iterating all tiles and
// calling removePellet/removePowerPellet), leaving exactly one collectible on
// the chosen tile. The player is then placed on that final tile and a single
// update() consumes it, driving remainingCollectibles() to 0 and the mode to
// 'won'. Varying the final tile over all collectibles exercises many distinct
// clearing orders (consumption sequences).
//
// Validates: Requirements 6.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';

// Fixed simulation step (ms) matching SIM_HZ (60 Hz) used across the sim.
const STEP_MS = 1000 / 60;

/**
 * Enumerate every tile of a maze that currently holds a collectible (pellet or
 * power pellet). Derived by scanning the grid so generators only ever target
 * genuine collectibles.
 * @param {Maze} maze
 * @returns {{col:number,row:number}[]}
 */
function collectibleTiles(maze) {
  const tiles = [];
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (maze.hasPellet(col, row) || maze.hasPowerPellet(col, row)) {
        tiles.push({ col, row });
      }
    }
  }
  return tiles;
}

/**
 * Clear every collectible from the maze EXCEPT the one on `keep`. Removal goes
 * through the public removePellet/removePowerPellet path, mirroring real
 * consumption. After this the maze has exactly one remaining collectible.
 * @param {Maze} maze
 * @param {{col:number,row:number}} keep
 * @returns {void}
 */
function clearAllExcept(maze, keep) {
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (col === keep.col && row === keep.row) continue;
      maze.removePellet(col, row);
      maze.removePowerPellet(col, row);
    }
  }
}

// Feature: pacman-hamster, Property 19: Clearing all collectibles wins the game
describe('Property 19: Clearing all collectibles wins the game', () => {
  it('transitions to `won` once the final collectible is consumed (Req 6.1)', () => {
    // Discover the collectible tiles of the default maze once; each run picks an
    // arbitrary one to be the LAST collectible cleared. A fresh Game is built
    // per run so consumption never leaks across examples.
    const collectibles = collectibleTiles(new Maze(DEFAULT_MAZE_LAYOUT));
    expect(collectibles.length).toBeGreaterThan(1);

    fc.assert(
      fc.property(fc.constantFrom(...collectibles), (finalTile) => {
        const game = new Game();
        game.start();
        expect(game.mode).toBe('playing');

        // Clear every collectible except the chosen final one, so exactly one
        // remains. The game is still playing and not yet won.
        clearAllExcept(game.maze, finalTile);
        expect(game.maze.remainingCollectibles()).toBe(1);
        expect(game.mode).toBe('playing');

        // Place the player directly on the final collectible tile with cleared
        // movement state, so a single update consumes it without first moving
        // off the tile.
        game.player.resetTo(finalTile);
        expect(game.player.tile).toEqual(finalTile);

        // One fixed step: the player consumes the last collectible, driving the
        // combined remaining count to 0 and the mode to 'won' (Req 6.1).
        game.update(STEP_MS, null);

        expect(game.maze.remainingCollectibles()).toBe(0);
        expect(game.mode).toBe('won');
      }),
      { numRuns: 100 },
    );
  });

  it('holds for custom small mazes cleared by walking the player across them (Req 6.1)', () => {
    // A tiny open corridor the player can walk end to end. The number of
    // pellets varies so distinct consumption-sequence lengths are exercised.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (pelletCount) => {
        // Build a single-row layout: wall, player spawn, N pellets, wall.
        // e.g. pelletCount=3 -> "#P...#"
        const layout = ['#' + 'P' + '.'.repeat(pelletCount) + '#'];
        const game = new Game(layout);
        game.start();

        const total = game.maze.remainingCollectibles();
        expect(total).toBe(pelletCount);

        // Walk right until every collectible is cleared. Movement is capped at
        // a generous bound so a bug that fails to clear/win surfaces as a
        // timeout-free assertion failure rather than an infinite loop.
        const maxSteps = (pelletCount + 2) * Math.ceil(1000 / 60 / STEP_MS) * 100;
        let steps = 0;
        while (game.mode === 'playing' && steps < maxSteps) {
          game.update(STEP_MS, 'right');
          steps++;
        }

        // Clearing all collectibles must have driven the game to 'won'.
        expect(game.maze.remainingCollectibles()).toBe(0);
        expect(game.mode).toBe('won');
      }),
      { numRuns: 100 },
    );
  });
});
