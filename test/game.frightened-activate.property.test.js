// test/game.frightened-activate.property.test.js
//
// Property-based test for power-pellet activation of the Frightened state
// (task 9.7).
//
// Covers design Property 12 "A power pellet activates Frightened state for the
// full duration": consuming a Power_Pellet puts the Game into Frightened_State
// with a remaining duration equal to FRIGHTENED_MS (8000 ms), regardless of the
// Frightened state the Game was in beforehand. Re-consuming a Power_Pellet while
// already Frightened resets the remaining duration back to the full FRIGHTENED_MS
// rather than extending or ignoring it.
//
// Strategy: drive a real Game to actually consume a power pellet. The default
// maze's power-pellet tiles are discovered by scanning game.maze.hasPowerPellet,
// the player is positioned on one of them, the game is started, and a single
// fixed step is advanced with no movement intent so the player stays on the tile
// and consumes the pellet. We vary the prior Frightened state (inactive, or
// partially decayed to an arbitrary remaining time) to confirm activation always
// snaps to the full duration independent of prior state.
//
// Validates: Requirements 4.1, 4.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

const { FRIGHTENED_MS } = CONFIG;

/**
 * Scan a game's maze for every tile that currently holds a power pellet.
 * Derived from the public hasPowerPellet query so generators only ever target
 * genuine power-pellet tiles.
 * @param {Game} game
 * @returns {{col:number,row:number}[]}
 */
function powerPelletTiles(game) {
  const tiles = [];
  for (let row = 0; row < game.maze.height; row++) {
    for (let col = 0; col < game.maze.width; col++) {
      if (game.maze.hasPowerPellet(col, row)) tiles.push({ col, row });
    }
  }
  return tiles;
}

/**
 * Place the player on a tile and clear its movement state so a null-intent
 * update leaves it there. The player keeps dir === null and progress === 0, so
 * the next update holds position and the game reads this tile for consumption.
 * @param {Game} game
 * @param {{col:number,row:number}} tile
 * @returns {void}
 */
function placePlayerOn(game, tile) {
  game.player.resetTo(tile);
}

// Discover the power-pellet tiles of the default maze once for the generators.
const POWER_TILES = powerPelletTiles(new Game());

// Feature: pacman-hamster, Property 12: A power pellet activates Frightened state for the full duration
describe('Property 12: A power pellet activates Frightened state for the full duration', () => {
  it('activates Frightened with the full FRIGHTENED_MS remaining, regardless of prior state (Req 4.1, 4.7)', () => {
    expect(POWER_TILES.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...POWER_TILES),
        // Prior Frightened state before consumption: either inactive, or active
        // with an arbitrary remaining time in (0, FRIGHTENED_MS].
        fc.oneof(
          fc.constant(null),
          fc.integer({ min: 1, max: FRIGHTENED_MS })
        ),
        ({ col, row }, priorRemaining) => {
          const game = new Game();
          game.start();

          // Impose the prior Frightened state directly on the private sub-state
          // so we exercise activation "regardless of prior state".
          if (priorRemaining == null) {
            game._frightened = { active: false, remainingMs: 0 };
          } else {
            game._frightened = { active: true, remainingMs: priorRemaining };
          }

          placePlayerOn(game, { col, row });
          expect(game.maze.hasPowerPellet(col, row)).toBe(true);

          // Advance exactly one fixed step with no movement intent. The player
          // holds on the power-pellet tile and consumes it this step. Activation
          // sets remaining to FRIGHTENED_MS, then this same step's timer
          // countdown subtracts stepMs, so afterwards exactly one step has
          // elapsed from the full duration.
          const stepMs = 1000 / CONFIG.SIM_HZ;
          game.update(stepMs, null);

          // Frightened is active and the pellet is gone.
          expect(game.frightened).toBe(true);
          expect(game.maze.hasPowerPellet(col, row)).toBe(false);

          // Remaining duration equals the full FRIGHTENED_MS minus the single
          // step already elapsed this update — i.e. activation snapped to the
          // full duration, independent of priorRemaining.
          expect(game.frightenedRemainingMs).toBe(FRIGHTENED_MS - stepMs);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('re-consumption resets the remaining duration to full after partial decay (Req 4.7)', () => {
    // At least two distinct power-pellet tiles are needed to consume twice.
    expect(POWER_TILES.length).toBeGreaterThanOrEqual(2);

    fc.assert(
      fc.property(
        // Two distinct power-pellet tile indices.
        fc
          .tuple(
            fc.integer({ min: 0, max: POWER_TILES.length - 1 }),
            fc.integer({ min: 0, max: POWER_TILES.length - 1 })
          )
          .filter(([a, b]) => a !== b),
        // How many fixed steps to let the first activation decay before the
        // second consumption, bounded so the timer stays active (> 0).
        fc.integer({ min: 1, max: 100 }),
        ([i, j], decaySteps) => {
          const stepMs = 1000 / CONFIG.SIM_HZ;
          const first = POWER_TILES[i];
          const second = POWER_TILES[j];

          const game = new Game();
          game.start();

          // First consumption: activate Frightened on the first tile.
          placePlayerOn(game, first);
          game.update(stepMs, null);
          expect(game.frightened).toBe(true);

          // Let the Frightened timer partially decay by moving the player off
          // the pellet tiles (to an arbitrary empty-of-powerpellet cell) and
          // advancing several steps. Keep decay strictly below the full
          // duration so the state is still active (partial decay).
          const maxDecay = Math.min(
            decaySteps,
            Math.floor((FRIGHTENED_MS - stepMs) / stepMs) - 1
          );
          const decay = Math.max(1, maxDecay);
          // Park the player on the first (now-empty) tile so no new pellet is
          // consumed during decay.
          for (let s = 0; s < decay; s++) {
            placePlayerOn(game, first);
            game.update(stepMs, null);
          }
          expect(game.frightened).toBe(true);
          const decayed = game.frightenedRemainingMs;
          // Confirm the timer actually decayed below full.
          expect(decayed).toBeLessThan(FRIGHTENED_MS - stepMs);

          // Re-consume a power pellet on the second tile while still Frightened.
          placePlayerOn(game, second);
          expect(game.maze.hasPowerPellet(second.col, second.row)).toBe(true);
          game.update(stepMs, null);

          // The timer is reset to full (minus the one step elapsed this update),
          // strictly greater than the decayed value — not extended, not ignored.
          expect(game.frightened).toBe(true);
          expect(game.frightenedRemainingMs).toBe(FRIGHTENED_MS - stepMs);
          expect(game.frightenedRemainingMs).toBeGreaterThan(decayed);
        }
      ),
      { numRuns: 100 }
    );
  });
});
