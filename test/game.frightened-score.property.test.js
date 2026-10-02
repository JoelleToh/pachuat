// test/game.frightened-score.property.test.js
//
// Property-based test for Frightened-state enemy consumption scoring on the
// Game simulation hub (task 9.5).
//
// Covers design Property 9 "Frightened consumption scores 200 per enemy": for
// all sets of enemies overlapping the player's tile during Frightened state,
// the score increases by exactly 200 multiplied by the number of enemies
// consumed, and each consumed enemy begins relocating to its spawn
// (`returning`).
//
// The test drives the real Game.update path (no mocking): it starts a game,
// activates Frightened state, positions a generated subset of the four
// hamsters directly onto the player's tile, records the score, advances one
// fixed step, and asserts the score delta equals 200 * consumedCount.
//
// To keep the scenario deterministic, the player's tile is cleared of any
// collectible first (so neither the pellet/power-pellet nor the win branch of
// update perturbs the score) and a sub-millisecond step is used so no entity
// completes a whole-tile crossing within the step: enemies placed on the
// player's tile stay overlapping after movement, and the remaining enemies
// (left on their distant spawns) cannot reach the player's tile.
//
// Validates: Requirements 2.3, 4.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

const ENEMY_POINTS = CONFIG.POINTS.ENEMY; // 200

/**
 * Builds a fresh game in `playing` mode with Frightened state active and the
 * player's tile cleared of collectibles. Returns the player's tile so the
 * caller can position enemies onto it.
 * @returns {{ game: Game, playerTile: {col:number,row:number} }}
 */
function freshFrightenedGame() {
  const game = new Game();
  game.start(); // ready -> playing (Req 9.5)

  // Activate Frightened state with plenty of time remaining so the step under
  // test resolves consumption rather than any timeout edge (Req 4.1).
  game._frightened.active = true;
  game._frightened.remainingMs = CONFIG.FRIGHTENED_MS;

  // Clear any collectible on the player's current tile so the pellet /
  // power-pellet / win branches of update() leave the score untouched. The
  // removers are idempotent and return 0 on an empty tile.
  const { col, row } = game.player.tile;
  game.maze.removePellet(col, row);
  game.maze.removePowerPellet(col, row);

  return { game, playerTile: { col, row } };
}

// Feature: pacman-hamster, Property 9: Frightened consumption scores 200 per enemy
describe('Property 9: Frightened consumption scores 200 per enemy', () => {
  it('increases the score by exactly 200 * (overlapping enemies) during Frightened state', () => {
    fc.assert(
      fc.property(
        // The number of the four hamsters overlapping the player's tile (0..4).
        fc.integer({ min: 0, max: 4 }),
        (consumedCount) => {
          const { game, playerTile } = freshFrightenedGame();
          expect(game.enemies.length).toBe(4);

          // Place the first `consumedCount` hamsters exactly on the player's
          // tile (centered, chase mode) so they overlap after moving. Leave the
          // remaining hamsters on their own spawns, far from the player.
          for (let i = 0; i < consumedCount; i++) {
            const enemy = game.enemies[i];
            enemy.tile = { col: playerTile.col, row: playerTile.row };
            enemy.progress = 0;
            enemy.mode = 'chase';
          }

          const before = game.score;

          // A sub-millisecond step: no entity completes a whole-tile crossing,
          // so overlapping enemies remain on the player's tile and the player
          // does not move off it (intent null). Consumption is resolved exactly
          // once for each overlapping, non-returning hamster.
          game.update(0.1, null);

          const delta = game.score - before;

          // The score increases by exactly 200 per consumed enemy (Req 2.3, 4.5).
          expect(delta).toBe(ENEMY_POINTS * consumedCount);

          // Each consumed hamster is now relocating to its spawn (`returning`),
          // confirming it was the overlap that triggered the award.
          for (let i = 0; i < consumedCount; i++) {
            expect(game.enemies[i].mode).toBe('returning');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
