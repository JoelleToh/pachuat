// test/game.frightened-timeout.property.test.js
//
// Property-based test for the Frightened-timeout return to pursuit on the Game
// simulation hub (task 9.9).
//
// Covers design Property 14 "Frightened timeout returns non-relocating enemies
// to pursuit": for all game states at the moment the Frightened timer reaches
// zero, every enemy that is NOT currently relocating (`returning`) transitions
// back to chase mode. Enemies that were relocating when the timer expired are
// allowed to finish their trip to spawn first (Req 4.8) and so are not required
// to be in chase mode immediately — they must simply never be left frightened.
//
// Mechanics being exercised (see src/game.js + src/enemy.js):
//   - game.update() counts the Frightened timer down by stepMs after enemies
//     have moved; when it reaches 0 the Frightened flag (game.frightened) flips
//     to false (Req 4.6).
//   - On an enemy's next update() with the flag false, a non-returning hamster
//     re-syncs its mode to 'chase'; a 'returning' hamster ignores the flag and
//     keeps relocating until it reaches its spawn (Req 4.8).
//
// Strategy (no mocking, real Game.update path): start a game and impose a
// Frightened state with a small remaining time directly on the private
// sub-state (mirroring the sibling frightened-activate test). Optionally force
// a generated subset of the four hamsters into 'returning' mode on a non-spawn
// tile so they stay relocating across the window. Advance fixed steps with a
// null intent until the Frightened timer expires (game.frightened === false),
// then advance one more step so every enemy re-evaluates its mode with the flag
// now false. Finally assert: non-returning enemies are in chase mode, and no
// enemy remains frightened (returning ones may still be returning or already
// back to chase).
//
// To keep the scenario deterministic the player is parked on its spawn with a
// null intent and that tile is cleared of collectibles, so no power pellet
// re-activates Frightened and no overlap sends an enemy to spawn mid-window.
//
// Validates: Requirements 4.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

const STEP_MS = 1000 / CONFIG.SIM_HZ;

// Feature: pacman-hamster, Property 14: Frightened timeout returns non-relocating enemies to pursuit
describe('Property 14: Frightened timeout returns non-relocating enemies to pursuit', () => {
  it('returns every non-relocating enemy to chase once the Frightened timer reaches zero (Req 4.6)', () => {
    fc.assert(
      fc.property(
        // Small remaining Frightened time (in whole steps) so the window closes
        // after a handful of updates. Bounded well below FRIGHTENED_MS.
        fc.integer({ min: 1, max: 20 }),
        // Which of the four hamsters start out relocating to spawn. The subset
        // is encoded as a boolean per enemy.
        fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        (remainingSteps, returningMask) => {
          const game = new Game();
          game.start(); // ready -> playing (Req 9.5)

          expect(game.enemies.length).toBe(4);

          // Park the player on its spawn and clear any collectible there so no
          // power pellet re-activates Frightened during the window and the win
          // branch never fires.
          const { col: pcol, row: prow } = game.player.tile;
          game.maze.removePellet(pcol, prow);
          game.maze.removePowerPellet(pcol, prow);
          const playerTile = { col: pcol, row: prow };

          // Impose a Frightened state with the chosen small remaining time.
          game._frightened = { active: true, remainingMs: remainingSteps * STEP_MS };

          // Force the selected hamsters into 'returning' mode on a tile that is
          // NOT their own spawn, so they keep relocating across the whole window
          // instead of instantly flipping back to chase. The player's spawn is a
          // convenient open, non-hamster-spawn tile distant from each hamster
          // spawn in the default maze.
          const forcedReturning = [];
          game.enemies.forEach((enemy, i) => {
            if (returningMask[i]) {
              enemy.tile = { col: playerTile.col, row: playerTile.row };
              enemy.progress = 0;
              enemy.dir = null;
              enemy.mode = 'returning';
              forcedReturning.push(i);
            }
          });

          // Advance until the Frightened timer expires. Enemies forced onto the
          // player's tile are 'returning', so they are not consumed (consumption
          // only targets non-returning overlaps), and the player holds still on a
          // collectible-free tile, so the score/win branches stay inert.
          let guard = 0;
          while (game.frightened && guard < 1000) {
            game.update(STEP_MS, null);
            guard += 1;
          }

          // The window must have actually closed within the bounded steps.
          expect(game.frightened).toBe(false);

          // One more step with the flag now false lets every enemy re-evaluate
          // its mode on its next update (the countdown that cleared the flag
          // happened AFTER enemies moved in the expiring step).
          game.update(STEP_MS, null);

          // Core property: no enemy is left frightened once the timer is zero,
          // and every non-relocating enemy is back in chase (Req 4.6). Enemies
          // that were still relocating are allowed to keep returning (Req 4.8)
          // or to have already arrived and flipped to chase — never frightened.
          game.enemies.forEach((enemy) => {
            expect(enemy.mode).not.toBe('frightened');
            if (enemy.mode !== 'returning') {
              expect(enemy.mode).toBe('chase');
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
