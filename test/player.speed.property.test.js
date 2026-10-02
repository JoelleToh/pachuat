// test/player.speed.property.test.js
//
// Property-based test for constant-speed player movement (task 6.2).
//
// Covers design Property 1 "Movement along open paths is constant-speed":
// for all open corridors and any number of fixed simulation steps during
// which the requested direction stays open, the player's cumulative
// displacement equals PLAYER_SPEED_TPS * elapsedSeconds (within one-tile
// tolerance) and the movement direction is preserved.
//
// The player exposes a continuous render position `pixel = { x, y }` in tile
// units (col/row space), computed from the logical tile plus sub-tile
// progress. Cumulative displacement from the start tile is therefore the
// Euclidean distance from the starting pixel position to the current one.
//
// To keep the requested direction open for the entire run we build a maze
// with a single long horizontal corridor bounded by walls (no tunnels), and
// place the player far enough from the right wall that it never reaches it
// within the generated number of steps. Driving `update` with a constant
// rightward intent then advances the player at a constant 6 tiles/second.
//
// Validates: Requirements 1.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Player } from '../src/player.js';
import { Maze } from '../src/maze.js';
import { CONFIG } from '../src/constants.js';

const { PLAYER_SPEED_TPS, SIM_HZ } = CONFIG;

// The fixed simulation timestep in milliseconds (1000 / SIM_HZ).
const STEP = 1000 / SIM_HZ;

/**
 * Builds a maze consisting of a single horizontal corridor of `corridorLen`
 * open tiles, bounded above/below and on the ends by walls. The player spawns
 * at the left-most open tile and can travel right across the whole corridor.
 *
 * Layout (corridorLen = 5):
 *   #######
 *   #P....#
 *   #######
 *
 * The open row is rows[1]; the player spawn `P` sits at column 1 and the
 * remaining corridor tiles are plain paths (spaces) so there are no pellets to
 * interact with and nothing but open path ahead.
 *
 * @param {number} corridorLen Number of open tiles in the corridor (>= 2).
 * @returns {Maze}
 */
function makeCorridor(corridorLen) {
  const inner = 'P' + ' '.repeat(corridorLen - 1);
  const width = corridorLen + 2; // walls on both ends
  const wallRow = '#'.repeat(width);
  const openRow = '#' + inner + '#';
  return new Maze([wallRow, openRow, wallRow]);
}

/**
 * Euclidean displacement (in tile units) between two pixel positions.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
function displacement(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Feature: pacman-hamster, Property 1: Movement along open paths is constant-speed
describe('Property 1: Movement along open paths is constant-speed', () => {
  it('cumulative displacement equals PLAYER_SPEED_TPS * elapsedSeconds and dir is preserved (Req 1.3)', () => {
    fc.assert(
      fc.property(
        // A number of fixed simulation steps to advance. Bounded so the player
        // stays within the corridor it is given below.
        fc.integer({ min: 1, max: 240 }),
        (steps) => {
          // Distance the player will travel over `steps` steps, in tiles.
          const expectedTiles = PLAYER_SPEED_TPS * ((steps * STEP) / 1000);

          // Size the corridor so the requested direction stays open for the
          // whole run: enough open tiles that the player never reaches the far
          // wall. A couple of tiles of head-room covers one-tile rounding.
          const corridorLen = Math.ceil(expectedTiles) + 3;
          const maze = makeCorridor(corridorLen);

          const spawn = maze.playerSpawn;
          const player = new Player(spawn);
          const start = { ...player.pixel };

          // Drive the player rightward along the open corridor for `steps`
          // fixed steps, holding a constant intent the whole time.
          for (let i = 0; i < steps; i++) {
            player.update(STEP, maze, 'right');
          }

          const traveled = displacement(start, player.pixel);

          // Constant-speed: cumulative displacement equals speed * elapsed time
          // within a one-tile tolerance (the player moves in discrete tile
          // crossings, so the continuous position lags/leads by < 1 tile).
          expect(Math.abs(traveled - expectedTiles)).toBeLessThanOrEqual(1);

          // Direction is preserved while the path ahead stays open.
          expect(player.dir).toBe('right');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for vertical corridors as well, confirming speed is direction-independent (Req 1.3)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 240 }), (steps) => {
        const expectedTiles = PLAYER_SPEED_TPS * ((steps * STEP) / 1000);
        const corridorLen = Math.ceil(expectedTiles) + 3;

        // Build a vertical corridor: a single open column with the player
        // spawn at the top, bounded by walls on every side.
        const rows = ['###'];
        rows.push('#P#');
        for (let i = 1; i < corridorLen; i++) rows.push('# #');
        rows.push('###');
        const maze = new Maze(rows);

        const player = new Player(maze.playerSpawn);
        const start = { ...player.pixel };

        for (let i = 0; i < steps; i++) {
          player.update(STEP, maze, 'down');
        }

        const traveled = displacement(start, player.pixel);
        expect(Math.abs(traveled - expectedTiles)).toBeLessThanOrEqual(1);
        expect(player.dir).toBe('down');
      }),
      { numRuns: 100 },
    );
  });
});
