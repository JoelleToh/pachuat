// test/player.buffer.property.test.js
//
// Property-based test for buffered player turns (task 6.5).
//
// Covers design Property 5 "Buffered turns apply at the first open tile and
// expire after one second":
//   - When a direction is requested slightly early (while it still points at a
//     wall), it is buffered and applied as the movement direction at the first
//     subsequently reached tile where that direction is open, provided such a
//     tile is reached within BUFFER_EXPIRE_MS (1000 ms).
//   - When no open tile for the buffered direction is reached within 1000 ms,
//     the buffer is discarded (bufferedDir becomes null) and the turn never
//     happens.
//
// src/player.js buffering semantics exercised here:
//   - update(stepMs, maze, intent): a non-null intent sets requestedDir and
//     (re)arms the buffer (bufferedDir = intent, bufferAgeMs = 0).
//   - At each tile center the chosen direction is: an open requested turn, then
//     an open buffered turn, then the current direction if still open, else
//     stop. So a turn requested early is applied at the first open tile.
//   - _ageBuffer increments bufferAgeMs by stepMs each update and discards the
//     buffer once bufferAgeMs >= BUFFER_EXPIRE_MS.
//
// The update method is deterministic (no clocks/randomness), so these scenarios
// are driven directly by fixed-step updates.
//
// Validates: Requirements 1.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Player } from '../src/player.js';
import { Maze } from '../src/maze.js';
import { CONFIG } from '../src/constants.js';

const { PLAYER_SPEED_TPS, SIM_HZ, BUFFER_EXPIRE_MS } = CONFIG;

// Fixed simulation timestep in milliseconds (1000 / SIM_HZ).
const STEP = 1000 / SIM_HZ;

/**
 * Builds a maze with a single horizontal corridor on row 1 and a downward side
 * branch opening at column `junctionCol`. The player spawns at the left-most
 * corridor tile (column 1). Moving right, every tile before `junctionCol` has a
 * wall directly below it, so a `down` request there is blocked and must be
 * buffered; at `junctionCol` the tile below is open, so the buffered turn can
 * finally be applied.
 *
 * Layout (corridorLen = 6, junctionCol = 4):
 *   ########    row 0 (wall)
 *   #P.....#    row 1 (corridor; player spawn at col 1)
 *   ####.###    row 2 (opening only beneath col 4)
 *   ####.###    row 3 (branch continues down)
 *   ########    row 4 (wall)
 *
 * @param {number} corridorLen Number of open tiles in the horizontal corridor.
 * @param {number} junctionCol Column (within the corridor) where `down` opens.
 * @returns {Maze}
 */
function makeDownBranchMaze(corridorLen, junctionCol) {
  const width = corridorLen + 2; // walls on both ends
  const wallRow = '#'.repeat(width);

  // Corridor row: 'P' at col 1, open path elsewhere.
  const corridorChars = Array.from({ length: width }, () => '#');
  for (let c = 1; c <= corridorLen; c++) corridorChars[c] = ' ';
  corridorChars[1] = 'P';
  const corridorRow = corridorChars.join('');

  // Branch rows: a wall everywhere except an opening at `junctionCol`.
  const branchChars = Array.from({ length: width }, () => '#');
  branchChars[junctionCol] = ' ';
  const branchRow = branchChars.join('');

  return new Maze([wallRow, corridorRow, branchRow, branchRow, wallRow]);
}

/**
 * Builds a straight horizontal corridor with no side branches (and no tunnels),
 * so a `down`/`up` turn never opens anywhere along it. The player spawns at the
 * left-most tile and travels right.
 *
 * @param {number} corridorLen Number of open tiles in the corridor (>= 2).
 * @returns {Maze}
 */
function makeStraightCorridor(corridorLen) {
  const inner = 'P' + ' '.repeat(corridorLen - 1);
  const width = corridorLen + 2;
  const wallRow = '#'.repeat(width);
  const openRow = '#' + inner + '#';
  return new Maze([wallRow, openRow, wallRow]);
}

// Feature: pacman-hamster, Property 5: Buffered turns apply at the first open tile and expire after one second
describe('Property 5: Buffered turns apply at the first open tile and expire after one second', () => {
  it('applies an early-requested turn at the first tile where it is open, within 1000 ms (Req 1.7)', () => {
    fc.assert(
      fc.property(
        // Column (within the corridor) at which the downward branch opens. The
        // player must reach it within BUFFER_EXPIRE_MS, so keep it close to the
        // spawn: at 6 tiles/sec the player crosses ~6 tiles per second, and the
        // spawn sits at column 1.
        fc.integer({ min: 2, max: 4 }),
        (junctionCol) => {
          // Give a little corridor head-room past the junction.
          const corridorLen = junctionCol + 2;
          const maze = makeDownBranchMaze(corridorLen, junctionCol);
          const spawn = maze.playerSpawn; // { col: 1, row: 1 }
          const player = new Player(spawn);

          // Sanity: `down` is a wall at the spawn (so it must be buffered), and
          // `down` is open at the junction column (so the buffer can apply).
          expect(maze.isWall(spawn.col, spawn.row + 1)).toBe(true);
          expect(maze.isWall(junctionCol, spawn.row + 1)).toBe(false);

          // Start moving right along the corridor.
          player.update(STEP, maze, 'right');
          expect(player.dir).toBe('right');

          // Request `down` while still left of the junction, where `down` faces
          // a wall. This arms the buffer rather than turning immediately.
          player.update(STEP, maze, 'down');
          // The request could not be honored yet: still heading right, and the
          // turn is held pending an open tile.
          expect(player.dir).toBe('right');
          expect(player.bufferedDir).toBe('down');

          // Advance with no further intent until the buffer is either applied
          // or expires. Cap the loop well under the number of steps that would
          // elapse BUFFER_EXPIRE_MS so we can assert timeliness separately.
          const maxSteps = Math.ceil(BUFFER_EXPIRE_MS / STEP) + 5;
          let turnedAtTile = null;
          let stepsTaken = 0;
          for (let i = 0; i < maxSteps; i++) {
            player.update(STEP, maze, null);
            stepsTaken++;
            if (player.dir === 'down') {
              turnedAtTile = { ...player.tile };
              break;
            }
          }

          // The buffered turn was applied (the player is now heading down).
          expect(player.dir).toBe('down');
          // It was applied at the first tile where `down` is open: the junction
          // column, on the corridor row.
          expect(turnedAtTile).toEqual({ col: junctionCol, row: spawn.row });
          // Applying the turn consumed the buffer.
          expect(player.bufferedDir).toBeNull();
          // And it happened within the 1000 ms buffer window.
          expect(stepsTaken * STEP).toBeLessThan(BUFFER_EXPIRE_MS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('discards the buffer after BUFFER_EXPIRE_MS when no open tile for the turn is reached (Req 1.7)', () => {
    fc.assert(
      fc.property(
        // The blocked turn to request (perpendicular to the corridor so it
        // always faces a wall along a straight horizontal corridor).
        fc.constantFrom('up', 'down'),
        (turn) => {
          // A straight corridor long enough that the player never reaches an
          // end wall before the buffer would expire; `up`/`down` never open.
          const corridorLen = 60;
          const maze = makeStraightCorridor(corridorLen);
          const player = new Player(maze.playerSpawn);

          // Start moving right, then request the perpendicular turn (blocked).
          player.update(STEP, maze, 'right');
          expect(player.dir).toBe('right');

          player.update(STEP, maze, turn);
          // The turn is buffered, not applied (it faces a wall everywhere here).
          expect(player.bufferedDir).toBe(turn);
          expect(player.dir).toBe('right');

          // The buffer has already aged by one step (the step that armed it is
          // itself aged at the end of update). Advance until it has lived at
          // least BUFFER_EXPIRE_MS, then confirm it has been discarded.
          const stepsToExpire = Math.ceil(BUFFER_EXPIRE_MS / STEP) + 1;
          for (let i = 0; i < stepsToExpire; i++) {
            // Throughout, the turn never opened, so it was never applied.
            expect(player.dir).toBe('right');
            player.update(STEP, maze, null);
          }

          // After the 1000 ms window the buffer is gone and the turn never
          // became the movement direction.
          expect(player.bufferedDir).toBeNull();
          expect(player.bufferAgeMs).toBe(0);
          expect(player.dir).toBe('right');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps the buffer below the 1000 ms boundary and discards it at or past it (Req 1.7)', () => {
    // The buffer must persist while it is younger than BUFFER_EXPIRE_MS and be
    // discarded exactly once its age reaches the window. We drive a straight
    // corridor (so the buffered perpendicular turn never opens and can only
    // ever expire) and step one update at a time, asserting the invariant that
    // ties the buffer's presence to its age at every step.
    fc.assert(
      fc.property(fc.constantFrom('up', 'down'), (turn) => {
        const maze = makeStraightCorridor(60);
        const player = new Player(maze.playerSpawn);

        player.update(STEP, maze, 'right');
        // Arm the buffer with a perpendicular (blocked) turn.
        player.update(STEP, maze, turn);
        expect(player.bufferedDir).toBe(turn);

        // Age of the buffer just before each step, so we can relate the age
        // crossing the window to the buffer being discarded on that step.
        let discarded = false;
        const maxSteps = Math.ceil(BUFFER_EXPIRE_MS / STEP) + 5;
        for (let i = 0; i < maxSteps && !discarded; i++) {
          const ageBefore = player.bufferAgeMs;
          player.update(STEP, maze, null);

          if (player.bufferedDir === null) {
            // Discarded only once its accumulated age reached the window.
            expect(ageBefore + STEP).toBeGreaterThanOrEqual(BUFFER_EXPIRE_MS);
            discarded = true;
          } else {
            // Still buffered means it has not yet reached the window.
            expect(player.bufferAgeMs).toBeLessThan(BUFFER_EXPIRE_MS);
            expect(player.bufferedDir).toBe(turn);
          }
          // The turn never opened along a straight corridor, so it was never
          // applied as a movement direction.
          expect(player.dir).toBe('right');
        }

        // The buffer did expire within the window (plus the tracked slack).
        expect(discarded).toBe(true);
        expect(player.bufferedDir).toBeNull();
        expect(player.bufferAgeMs).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
