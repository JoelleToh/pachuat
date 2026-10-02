// test/player.wall.property.test.js
//
// Property-based test for wall blocking on the Player entity (task 6.3).
//
// Covers design Property 2 "A wall blocks movement and preserves prior
// direction": for all open player tiles and maze configurations where the
// requested direction points at a wall, after a fixed-step update the player's
// tile is unchanged and the player does not acquire the blocked direction.
//
// Per src/player.js semantics: while centered on a tile, if the requested
// direction is blocked (and no open buffered/current direction applies), the
// player stops (`dir` becomes null) and stays on the same tile. The blocked
// request is buffered (so it can later apply at an open tile) but never becomes
// the movement direction, and no displacement occurs. This test isolates that
// behavior by placing the player on a tile whose only candidate motion is the
// requested wall-facing direction (prior dir null, requested points at a wall).
//
// Validates: Requirements 1.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Player } from '../src/player.js';
import { Maze } from '../src/maze.js';
import { CONFIG, VECTORS } from '../src/constants.js';

const STEP_MS = 1000 / CONFIG.SIM_HZ;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * Enumerate, for a maze, every (open tile, direction) pair where moving in that
 * direction from the tile points directly at a wall (or out of bounds, which
 * the Maze treats as a wall). These are exactly the scenarios where the request
 * must be blocked.
 * @param {Maze} maze
 * @returns {{ col:number, row:number, dir:string }[]}
 */
function wallFacingScenarios(maze) {
  const scenarios = [];
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (maze.isWall(col, row)) continue; // player can only stand on open tiles
      if (maze.isTunnelExit(col, row)) continue; // avoid tunnel-wrap edge cases
      for (const dir of DIRECTIONS) {
        const { dcol, drow } = VECTORS[dir];
        if (maze.isWall(col + dcol, row + drow)) {
          scenarios.push({ col, row, dir });
        }
      }
    }
  }
  return scenarios;
}

// Feature: pacman-hamster, Property 2: A wall blocks movement and preserves prior direction
describe('Property 2: A wall blocks movement and preserves prior direction', () => {
  it('stays on the same tile and does not acquire a wall-facing direction (Req 1.4)', () => {
    // Generate small single-row maze layouts (walls, paths, pellets) plus a
    // wall-facing scenario drawn from each. Single-row layouts give abundant
    // vertical walls (grid edges) and interior horizontal walls, so the input
    // space is rich with genuine "request points at a wall" cases.
    const cellArb = fc.constantFrom('#', ' ', '.');

    const scenarioArb = fc
      .array(cellArb, { minLength: 3, maxLength: 24 })
      .map((cells) => [cells.join('')])
      // Keep only layouts that contain at least one open tile.
      .filter((layout) => /[ .]/.test(layout[0]))
      .chain((layout) => {
        const maze = new Maze(layout);
        const scenarios = wallFacingScenarios(maze);
        // Discard layouts with no wall-facing scenario; grid edges guarantee
        // most non-trivial single-row layouts have several.
        return scenarios.length === 0
          ? fc.constant(null)
          : fc.record({
              layout: fc.constant(layout),
              scenario: fc.constantFrom(...scenarios),
            });
      })
      .filter((v) => v !== null);

    fc.assert(
      fc.property(scenarioArb, ({ layout, scenario }) => {
        const maze = new Maze(layout);
        const { col, row, dir } = scenario;

        const player = new Player({ col, row });
        // Precondition: player starts centered on an open tile with no prior
        // movement direction, and the requested direction faces a wall.
        expect(player.tile).toEqual({ col, row });
        expect(player.dir).toBeNull();
        const { dcol, drow } = VECTORS[dir];
        expect(maze.isWall(col + dcol, row + drow)).toBe(true);

        player.update(STEP_MS, maze, dir);

        // The wall blocks movement: the tile is unchanged.
        expect(player.tile).toEqual({ col, row });
        // The player never acquires the blocked (wall-facing) direction.
        expect(player.dir).not.toBe(dir);
        // With no other open option the player stops (prior direction retained,
        // which was null here); it certainly has not started moving.
        expect(player.dir).toBeNull();
        // No sub-tile displacement occurred.
        expect(player.progress).toBe(0);
        // The render position stays centered on the tile.
        expect(player.pixel).toEqual({ x: col, y: row });
      }),
      { numRuns: 100 },
    );
  });

  it('retains a prior movement direction when a new request faces a wall (Req 1.4)', () => {
    // A corridor where the player is already moving right. Requesting a turn
    // into a wall (up/down are walls here) must not change the tile and must
    // not acquire the blocked direction; the prior rightward motion is kept.
    //   layout: # . . . #   (row 0)
    // The player sits on an interior open tile moving right; up/down are the
    // grid edges (walls).
    const maze = new Maze(['#...#']);
    const startCol = 1;
    const row = 0;

    fc.assert(
      fc.property(fc.constantFrom('up', 'down'), (wallDir) => {
        const player = new Player({ col: startCol, row });
        // Establish prior rightward motion by stepping once with intent right.
        player.update(STEP_MS, maze, 'right');
        expect(player.dir).toBe('right');
        const tileBefore = { ...player.tile };

        // Now request a direction that faces a wall (vertical, into the edge).
        const { dcol, drow } = VECTORS[wallDir];
        expect(maze.isWall(player.tile.col + dcol, player.tile.row + drow)).toBe(true);
        player.update(STEP_MS, maze, wallDir);

        // The blocked request is never acquired as the movement direction.
        expect(player.dir).not.toBe(wallDir);
        // The prior direction (right) is preserved; the player keeps moving
        // along the open corridor rather than turning into the wall.
        expect(player.dir).toBe('right');
        // Horizontal progress continues; the player did not get stuck at the
        // tile it occupied before the blocked request.
        expect(player.tile.row).toBe(tileBefore.row);
      }),
      { numRuns: 100 },
    );
  });
});
