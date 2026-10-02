// test/maze.idempotent.property.test.js
//
// Property-based test for idempotent empty-tile consumption (task 3.3).
//
// Covers design Property 7 "Consuming an already-empty tile is idempotent on
// score": for all tiles whose pellet or power pellet has already been removed,
// occupying (consuming) that tile again leaves the score and the
// remaining-collectible count unchanged. Tiles that never held a collectible
// always yield 0 points.
//
// Validates: Requirements 2.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';
import { CONFIG } from '../src/constants.js';

const POINTS = CONFIG.POINTS; // { PELLET: 10, POWER_PELLET: 50, ... }

/**
 * Scan a layout once to classify every tile by its collectible kind. This lets
 * the generators constrain to the exact input space the property talks about:
 * pellet tiles, power-pellet tiles, and non-collectible tiles.
 *
 * @param {ReadonlyArray<string>} layout
 * @returns {{ pellets: {col:number,row:number}[],
 *             powerPellets: {col:number,row:number}[],
 *             nonCollectibles: {col:number,row:number}[] }}
 */
function classifyTiles(layout) {
  const pellets = [];
  const powerPellets = [];
  const nonCollectibles = [];
  for (let row = 0; row < layout.length; row++) {
    const line = layout[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') pellets.push({ col, row });
      else if (ch === 'o') powerPellets.push({ col, row });
      else nonCollectibles.push({ col, row }); // walls, paths, spawns, tunnels
    }
  }
  return { pellets, powerPellets, nonCollectibles };
}

const { pellets, powerPellets, nonCollectibles } = classifyTiles(DEFAULT_MAZE_LAYOUT);

// Feature: pacman-hamster, Property 7: Consuming an already-empty tile is idempotent on score
describe('Property 7: Consuming an already-empty tile is idempotent on score', () => {
  it('second removal of a pellet tile returns 0 and does not change remaining count', () => {
    fc.assert(
      fc.property(fc.constantFrom(...pellets), (tile) => {
        const maze = new Maze(DEFAULT_MAZE_LAYOUT);

        // First removal returns the exact pellet point value and clears it.
        const first = maze.removePellet(tile.col, tile.row);
        expect(first).toBe(POINTS.PELLET);
        expect(maze.hasPellet(tile.col, tile.row)).toBe(false);

        // Capture state after the first (effective) removal.
        const remainingAfterFirst = maze.remainingCollectibles();

        // Second removal of the now-empty tile is idempotent: 0 points, and the
        // remaining-collectible count is unchanged.
        const second = maze.removePellet(tile.col, tile.row);
        expect(second).toBe(0);
        expect(maze.remainingCollectibles()).toBe(remainingAfterFirst);

        // Repeated extra removals remain idempotent too.
        expect(maze.removePellet(tile.col, tile.row)).toBe(0);
        expect(maze.remainingCollectibles()).toBe(remainingAfterFirst);
      }),
      { numRuns: 100 },
    );
  });

  it('second removal of a power-pellet tile returns 0 and does not change remaining count', () => {
    fc.assert(
      fc.property(fc.constantFrom(...powerPellets), (tile) => {
        const maze = new Maze(DEFAULT_MAZE_LAYOUT);

        // First removal returns the exact power-pellet point value and clears it.
        const first = maze.removePowerPellet(tile.col, tile.row);
        expect(first).toBe(POINTS.POWER_PELLET);
        expect(maze.hasPowerPellet(tile.col, tile.row)).toBe(false);

        const remainingAfterFirst = maze.remainingCollectibles();

        // Second removal of the empty tile is idempotent on score and count.
        const second = maze.removePowerPellet(tile.col, tile.row);
        expect(second).toBe(0);
        expect(maze.remainingCollectibles()).toBe(remainingAfterFirst);

        expect(maze.removePowerPellet(tile.col, tile.row)).toBe(0);
        expect(maze.remainingCollectibles()).toBe(remainingAfterFirst);
      }),
      { numRuns: 100 },
    );
  });

  it('tiles that never held a collectible always return 0 and leave the count unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(...nonCollectibles), (tile) => {
        const maze = new Maze(DEFAULT_MAZE_LAYOUT);
        const before = maze.remainingCollectibles();

        // Neither a pellet nor a power pellet exists here, so removal yields 0
        // and never alters the remaining-collectible count.
        expect(maze.removePellet(tile.col, tile.row)).toBe(0);
        expect(maze.removePowerPellet(tile.col, tile.row)).toBe(0);
        expect(maze.remainingCollectibles()).toBe(before);

        // A pellet tile and a power-pellet tile are mutually exclusive, so the
        // cross-removal (power on a pellet tile, etc.) is covered by the
        // non-collectible case above returning 0 for both kinds.
        expect(maze.removePellet(tile.col, tile.row)).toBe(0);
        expect(maze.removePowerPellet(tile.col, tile.row)).toBe(0);
        expect(maze.remainingCollectibles()).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
