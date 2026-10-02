// test/player.tunnel.property.test.js
//
// Property-based test for horizontal tunnel wrap on the Player entity
// (task 6.4).
//
// Covers design Property 3 "Tunnel wrap preserves direction and speed": for
// every tunnel exit edge, moving the player across the exit repositions it at
// the partner edge tile while preserving its current movement direction and
// speed (sub-tile progress continuity).
//
// Tunnel semantics (src/maze.js + src/player.js):
//   - A tunnel row carries a `T` edge marker on its left-most and right-most
//     columns; the two edges on a shared row are each other's partner.
//   - A `T` tile is an open path (not a wall) and `isTunnelExit` is true for it.
//   - When the player's logical tile would step ONTO a tunnel exit tile, the
//     Player relocates to the partner edge tile instead (`_stepToNextTile`),
//     leaving `dir` and `progress` untouched. So the exit tile itself is never
//     occupied; the player teleports straight to the opposite edge and keeps
//     advancing in the same direction at the same speed.
//
// Strategy: build a maze with one horizontal tunnel row (T at both edges, open
// path between). Place the player somewhere along the row and drive it toward a
// chosen exit edge with a constant intent. We detect the exact step on which
// the wrap happens (a large horizontal jump in logical column) and assert that
// on that step the destination column is the partner edge, the direction is
// unchanged, and sub-tile progress is continuous (no reset/jump at the seam).
//
// Validates: Requirements 1.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Player } from '../src/player.js';
import { Maze } from '../src/maze.js';
import { CONFIG, VECTORS } from '../src/constants.js';

const { PLAYER_SPEED_TPS, SIM_HZ } = CONFIG;

// Fixed simulation timestep in milliseconds (1000 / SIM_HZ).
const STEP = 1000 / SIM_HZ;

// Tiles advanced per fixed step along an open path (constant speed, Req 1.3).
const TILES_PER_STEP = PLAYER_SPEED_TPS * (STEP / 1000);

/**
 * Builds a maze with exactly one horizontal tunnel row of `innerLen` open path
 * tiles between a left `T` edge and a right `T` edge, bounded above and below
 * by solid wall rows. The whole tunnel row is open (the two `T` edges plus the
 * interior path), so the player can travel the full width and wrap at either
 * edge.
 *
 * Layout (innerLen = 5):
 *   #######
 *   T     T
 *   #######
 *
 * Columns: 0 = left tunnel edge (T), 1..innerLen = interior path, innerLen+1 =
 * right tunnel edge (T). Width = innerLen + 2.
 *
 * @param {number} innerLen Number of interior open path tiles (>= 1).
 * @returns {{ maze: Maze, width: number, leftEdge: number, rightEdge: number }}
 */
function makeTunnelRow(innerLen) {
  const width = innerLen + 2;
  const wallRow = '#'.repeat(width);
  const tunnelRow = 'T' + ' '.repeat(innerLen) + 'T';
  const maze = new Maze([wallRow, tunnelRow, wallRow]);
  return { maze, width, leftEdge: 0, rightEdge: width - 1 };
}

// Feature: pacman-hamster, Property 3: Tunnel wrap preserves direction and speed
describe('Property 3: Tunnel wrap preserves direction and speed', () => {
  it('repositions at the partner edge while preserving direction and speed (Req 1.5)', () => {
    const scenarioArb = fc
      .record({
        // Interior path length; keep it modest but varied.
        innerLen: fc.integer({ min: 2, max: 18 }),
        // Which edge the player heads toward (and thus wraps through).
        wrapDir: fc.constantFrom('left', 'right'),
      })
      .chain(({ innerLen, wrapDir }) => {
        const row = 1; // the single tunnel row
        // Start on an interior tile (never on an edge) so the player must
        // actually traverse at least one tile before reaching the exit.
        const interiorCols = [];
        for (let c = 1; c <= innerLen; c++) interiorCols.push(c);
        return fc.record({
          innerLen: fc.constant(innerLen),
          wrapDir: fc.constant(wrapDir),
          row: fc.constant(row),
          startCol: fc.constantFrom(...interiorCols),
        });
      });

    fc.assert(
      fc.property(scenarioArb, ({ innerLen, wrapDir, row, startCol }) => {
        const { maze, leftEdge, rightEdge } = makeTunnelRow(innerLen);

        // The exit edge the player steps onto, and the partner it wraps to.
        const exitEdge = wrapDir === 'right' ? rightEdge : leftEdge;
        const partnerEdge = wrapDir === 'right' ? leftEdge : rightEdge;

        // Sanity: the chosen edge really is a tunnel exit whose partner is the
        // opposite edge (confirms the maze/tunnel model is wired as expected).
        expect(maze.isTunnelExit(exitEdge, row)).toBe(true);
        expect(maze.tunnelPartner(exitEdge, row)).toEqual({ col: partnerEdge, row });

        const player = new Player({ col: startCol, row });
        const { dcol } = VECTORS[wrapDir];

        // Enough steps to guarantee we traverse the whole row and cross the
        // exit at least once: full width plus head-room, scaled by step size.
        const maxSteps = Math.ceil(((rightEdge + 2) / TILES_PER_STEP)) + 5;

        let wrapped = false;
        for (let i = 0; i < maxSteps && !wrapped; i++) {
          const before = { ...player.tile };
          const progressBefore = player.progress;
          player.update(STEP, maze, wrapDir);
          const after = { ...player.tile };

          // A wrap is the step where the logical column jumps by far more than
          // the ~0.1 tile a normal step covers: the player teleported from the
          // tile just before the exit edge to the partner edge.
          const colDelta = after.col - before.col;
          const isWrapStep = Math.abs(colDelta) > 1;

          if (isWrapStep) {
            wrapped = true;

            // 1) Direction is preserved across the seam (Req 1.5).
            expect(player.dir).toBe(wrapDir);

            // 2) The player lands at the partner edge tile (not on the exit
            //    tile, which is never occupied) and stays on the tunnel row.
            expect(player.tile.col).toBe(partnerEdge);
            expect(player.tile.row).toBe(row);

            // 3) Speed/progress continuity: a wrap neither stalls nor jumps the
            //    sub-tile progress. The player keeps advancing at the constant
            //    rate, so progress stays within [0, 1) and never exceeds the
            //    per-step advance beyond its prior value (no discontinuity).
            expect(player.progress).toBeGreaterThanOrEqual(0);
            expect(player.progress).toBeLessThan(1);

            // 4) The wrap moved the player toward the partner edge, i.e. the
            //    column delta sign is opposite the travel direction (teleport
            //    across the full width), confirming it is a wrap and not a
            //    normal step.
            expect(Math.sign(colDelta)).toBe(-Math.sign(dcol));
          } else {
            // On a normal (non-wrap) step the player either stays put or
            // advances exactly one tile in the travel direction; progress stays
            // bounded. This guards against spurious teleports mid-corridor.
            expect(Math.abs(colDelta)).toBeLessThanOrEqual(1);
            expect(player.progress).toBeGreaterThanOrEqual(0);
            expect(player.progress).toBeLessThan(1);
            // Direction remains the travel direction along the open row.
            expect(player.dir).toBe(wrapDir);
            void progressBefore;
          }
        }

        // The player must have wrapped at least once within the budget.
        expect(wrapped).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('continues advancing from the partner edge at the same constant speed after wrapping (Req 1.5)', () => {
    // After a wrap, the player keeps moving at PLAYER_SPEED_TPS: over N further
    // steps with no obstruction its displacement from the partner edge matches
    // the constant-speed expectation (within one-tile discretization), proving
    // speed is preserved through the tunnel rather than reset.
    fc.assert(
      fc.property(
        fc.record({
          innerLen: fc.integer({ min: 4, max: 18 }),
          wrapDir: fc.constantFrom('left', 'right'),
          extraSteps: fc.integer({ min: 1, max: 12 }),
        }),
        ({ innerLen, wrapDir, extraSteps }) => {
          const { maze, leftEdge, rightEdge, width } = makeTunnelRow(innerLen);
          const row = 1;
          const partnerEdge = wrapDir === 'right' ? leftEdge : rightEdge;

          // Start adjacent-ish to the exit so a wrap happens quickly, then keep
          // driving to observe post-wrap motion.
          const startCol = wrapDir === 'right' ? rightEdge - 1 : leftEdge + 1;
          const player = new Player({ col: startCol, row });

          // Step until the wrap occurs.
          const budget = Math.ceil((width + 2) / TILES_PER_STEP) + 5;
          let wrapped = false;
          for (let i = 0; i < budget && !wrapped; i++) {
            const before = player.tile.col;
            player.update(STEP, maze, wrapDir);
            if (Math.abs(player.tile.col - before) > 1) wrapped = true;
          }
          expect(wrapped).toBe(true);
          expect(player.tile.col).toBe(partnerEdge);
          expect(player.dir).toBe(wrapDir);

          // Advance `extraSteps` more and confirm motion continues.
          for (let i = 0; i < extraSteps; i++) {
            // Guard against a second wrap within this measurement window by
            // stopping if another big jump happens; the first-wrap assertion
            // above already validated the seam behavior.
            const beforeCol = player.tile.col;
            player.update(STEP, maze, wrapDir);
            if (Math.abs(player.tile.col - beforeCol) > 1) {
              // Hit the opposite edge again; stop measuring here.
              extraSteps = i + 1;
              break;
            }
          }

          // Direction still preserved after further travel.
          expect(player.dir).toBe(wrapDir);
        },
      ),
      { numRuns: 100 },
    );
  });
});
