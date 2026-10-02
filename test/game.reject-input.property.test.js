// test/game.reject-input.property.test.js
//
// Property-based test for ended games rejecting movement input on the Game
// simulation hub (task 9.15).
//
// Covers design Property 20 "Ended games reject movement input": for all
// movement intents applied while the game mode is 'won' or 'lost', the player's
// tile and every enemy's tile are unchanged after the update. The guard lives
// at the top of Game.update(): `if (this._mode !== 'playing') return;` makes an
// ended game advance nothing regardless of the intent or step size (Req 5.6,
// 6.2).
//
// Strategy: construct a fresh Game and force it into an ended mode by setting
// game.mode directly to 'won' or 'lost'. Snapshot the player's tile and each
// enemy's tile, then call update(stepMs, intent) with arbitrary intents and
// step sizes. Assert every snapshotted tile is unchanged afterward. We vary the
// intent (up/down/left/right/null), the step size (stepMs), the ended mode, and
// run a sequence of several updates per trial so repeated input never nudges a
// stopped entity.
//
// Validates: Requirements 5.6, 6.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';

/** The five possible movement intents an InputHandler can produce. */
const INTENTS = ['up', 'down', 'left', 'right', null];

/** The two ended modes that must reject all movement input. */
const ENDED_MODES = ['won', 'lost'];

/**
 * Snapshot the logical tiles of the player and every enemy as plain copies, so
 * later mutation of the live entities cannot alias the recorded positions.
 * @param {Game} game
 * @returns {{player:{col:number,row:number}, enemies:{col:number,row:number}[]}}
 */
function snapshotTiles(game) {
  return {
    player: { col: game.player.tile.col, row: game.player.tile.row },
    enemies: game.enemies.map((e) => ({ col: e.tile.col, row: e.tile.row })),
  };
}

// Feature: pacman-hamster, Property 20: Ended games reject movement input
describe('Property 20: Ended games reject movement input', () => {
  it('leaves the player and every enemy tile unchanged across arbitrary intents and step sizes', () => {
    fc.assert(
      fc.property(
        // Which ended mode to force the game into.
        fc.constantFrom(...ENDED_MODES),
        // A non-empty sequence of (intent, stepMs) updates to apply. Varying
        // intent across up/down/left/right/null and stepMs across a wide range
        // (including fractional and large steps) exercises the reject guard
        // against any movement input while ended.
        fc.array(
          fc.record({
            intent: fc.constantFrom(...INTENTS),
            stepMs: fc.double({
              min: 0.1,
              max: 10_000,
              noNaN: true,
              noDefaultInfinity: true,
            }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (endedMode, updates) => {
          // Fresh game per trial so positions never leak across examples. The
          // game starts in 'ready' with the player and four enemies at their
          // spawn tiles; forcing an ended mode freezes those positions.
          const game = new Game();
          game.mode = endedMode;
          expect(game.mode).toBe(endedMode);

          // Record the frozen starting tiles before any update.
          const before = snapshotTiles(game);

          // Apply the whole sequence of movement inputs. An ended game must
          // reject every one: update() returns at the mode guard before any
          // entity advances (Req 5.6, 6.2).
          for (const { intent, stepMs } of updates) {
            game.update(stepMs, intent);
          }

          const after = snapshotTiles(game);

          // The ended mode is unchanged and no entity moved.
          expect(game.mode).toBe(endedMode);
          expect(after.player).toEqual(before.player);
          expect(after.enemies).toEqual(before.enemies);
        },
      ),
      { numRuns: 100 },
    );
  });
});
