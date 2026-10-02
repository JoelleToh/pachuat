// test/maze.consume.property.test.js
//
// Property-based test for collectible consumption on the Maze model (task 3.2).
//
// Covers design Property 6 "Consuming a collectible removes it and adds its
// exact point value": for all mazes and tiles containing an uneaten
// collectible, when the player occupies that tile the collectible is removed,
// the remaining-collectible count decreases by exactly one, and the score
// increases by exactly 10 for a pellet or 50 for a power pellet.
//
// Validates: Requirements 2.1, 2.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';

const PELLET_POINTS = 10;
const POWER_PELLET_POINTS = 50;

/**
 * Enumerate the collectible tiles of a maze, split by kind. Derived by
 * scanning the grid so the generators only ever target genuine collectibles.
 * @param {Maze} maze
 * @returns {{ pellets: {col:number,row:number}[], powerPellets: {col:number,row:number}[] }}
 */
function collectibleTiles(maze) {
  const pellets = [];
  const powerPellets = [];
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (maze.hasPellet(col, row)) pellets.push({ col, row });
      else if (maze.hasPowerPellet(col, row)) powerPellets.push({ col, row });
    }
  }
  return { pellets, powerPellets };
}

// Feature: pacman-hamster, Property 6: Consuming a collectible removes it and adds its exact point value
describe('Property 6: Consuming a collectible removes it and adds its exact point value', () => {
  it('removes a pellet, decrements the count by one, and scores exactly 10 (Req 2.1)', () => {
    // Build the default maze once to discover its pellet tiles, then pick an
    // arbitrary one per run. A fresh maze is used for each run so consumption
    // does not leak between examples.
    const { pellets } = collectibleTiles(new Maze(DEFAULT_MAZE_LAYOUT));
    expect(pellets.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(fc.constantFrom(...pellets), ({ col, row }) => {
        const maze = new Maze(DEFAULT_MAZE_LAYOUT);

        // Precondition: an uneaten pellet occupies the tile.
        expect(maze.hasPellet(col, row)).toBe(true);
        const before = maze.remainingCollectibles();

        // The player occupies the tile and consumes the collectible.
        const points = maze.removePellet(col, row);

        // Exact point value for a pellet.
        expect(points).toBe(PELLET_POINTS);
        // The collectible is removed from the tile.
        expect(maze.hasPellet(col, row)).toBe(false);
        // Remaining-collectible count decreases by exactly one.
        expect(maze.remainingCollectibles()).toBe(before - 1);
      }),
      { numRuns: 100 },
    );
  });

  it('removes a power pellet, decrements the count by one, and scores exactly 50 (Req 2.2)', () => {
    const { powerPellets } = collectibleTiles(new Maze(DEFAULT_MAZE_LAYOUT));
    expect(powerPellets.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(fc.constantFrom(...powerPellets), ({ col, row }) => {
        const maze = new Maze(DEFAULT_MAZE_LAYOUT);

        // Precondition: an uneaten power pellet occupies the tile.
        expect(maze.hasPowerPellet(col, row)).toBe(true);
        const before = maze.remainingCollectibles();

        const points = maze.removePowerPellet(col, row);

        // Exact point value for a power pellet.
        expect(points).toBe(POWER_PELLET_POINTS);
        // The collectible is removed from the tile.
        expect(maze.hasPowerPellet(col, row)).toBe(false);
        // Remaining-collectible count decreases by exactly one.
        expect(maze.remainingCollectibles()).toBe(before - 1);
      }),
      { numRuns: 100 },
    );
  });

  it('holds across generated maze layouts for an arbitrary uneaten collectible', () => {
    // Generate small, rectangular, single-row layouts filled with a mix of
    // pellets (.), power pellets (o), walls (#), and empty paths, keeping the
    // input space constrained to valid Maze layouts. One collectible tile is
    // then consumed and the property re-checked across all mazes.
    const cellArb = fc.constantFrom('.', 'o', '#', ' ');

    const layoutArb = fc
      .array(cellArb, { minLength: 1, maxLength: 24 })
      .map((cells) => [cells.join('')])
      // Only keep layouts that contain at least one collectible to consume.
      .filter((layout) => /[.o]/.test(layout[0]));

    fc.assert(
      fc.property(
        layoutArb.chain((layout) => {
          const maze = new Maze(layout);
          const { pellets, powerPellets } = collectibleTiles(maze);
          const all = [
            ...pellets.map((t) => ({ ...t, kind: 'pellet' })),
            ...powerPellets.map((t) => ({ ...t, kind: 'power' })),
          ];
          // Pair the layout with an arbitrary collectible tile from it.
          return fc.record({
            layout: fc.constant(layout),
            target: fc.constantFrom(...all),
          });
        }),
        ({ layout, target }) => {
          const maze = new Maze(layout);
          const before = maze.remainingCollectibles();
          const { col, row, kind } = target;

          if (kind === 'pellet') {
            expect(maze.hasPellet(col, row)).toBe(true);
            expect(maze.removePellet(col, row)).toBe(PELLET_POINTS);
            expect(maze.hasPellet(col, row)).toBe(false);
          } else {
            expect(maze.hasPowerPellet(col, row)).toBe(true);
            expect(maze.removePowerPellet(col, row)).toBe(POWER_PELLET_POINTS);
            expect(maze.hasPowerPellet(col, row)).toBe(false);
          }

          // In every case the count drops by exactly one and the tile is empty.
          expect(maze.remainingCollectibles()).toBe(before - 1);
          expect(maze.hasPellet(col, row)).toBe(false);
          expect(maze.hasPowerPellet(col, row)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
