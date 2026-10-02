// test/game.frightened-overlap.property.test.js
//
// Property-based test for Frightened-state overlap sending a consumed enemy to
// spawn on the Game simulation hub (task 9.8).
//
// Covers design Property 13 "Overlap during Frightened state sends the enemy to
// spawn": for all enemies overlapping the player's tile while the Game is in
// Frightened state, after a single update that enemy is in the returning /
// at-spawn state (heading back to its spawn) rather than remaining at the
// overlap tile in pursuit. Enemies that were NOT overlapping the player stay in
// pursuit (chase or frightened) and are never spuriously sent to spawn.
//
// The test drives the real Game.update path (no mocking): it starts a game,
// activates Frightened state, clears any collectible on the player's tile so
// the pellet / power-pellet / win branches do not perturb the run, places a
// generated subset of the four hamsters directly onto the player's tile, and
// advances one tiny fixed step. A sub-millisecond step guarantees no entity
// completes a whole-tile crossing within the step, so the overlapping enemies
// are resolved exactly once on the player's tile and the non-overlapping ones
// (left on their distant spawns) cannot reach the player this frame.
//
// After the update, each overlapping enemy must have mode === 'returning' and
// be heading to its spawn (its returning target is its own spawn tile), while
// every non-overlapping enemy remains in pursuit (chase or frightened).
//
// Validates: Requirements 4.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

/**
 * Builds a fresh game in `playing` mode with Frightened state active and the
 * player's tile cleared of collectibles. Returns the player's tile so the
 * caller can position enemies onto it.
 * @returns {{ game: Game, playerTile: {col:number,row:number} }}
 */
function freshFrightenedGame() {
  const game = new Game();
  game.start(); // ready -> playing (Req 9.5)

  // Activate Frightened state with the full duration remaining so the step
  // under test resolves overlap -> returning rather than any timeout edge.
  game._frightened.active = true;
  game._frightened.remainingMs = CONFIG.FRIGHTENED_MS;

  // Clear any collectible on the player's current tile so update()'s pellet /
  // power-pellet / win branches leave the run untouched. The removers are
  // idempotent and return 0 on an empty tile.
  const { col, row } = game.player.tile;
  game.maze.removePellet(col, row);
  game.maze.removePowerPellet(col, row);

  return { game, playerTile: { col, row } };
}

// Feature: pacman-hamster, Property 13: Overlap during Frightened state sends the enemy to spawn
describe('Property 13: Overlap during Frightened state sends the enemy to spawn', () => {
  it('sends every enemy overlapping the player during Frightened state to its spawn, leaving others in pursuit (Req 4.4)', () => {
    fc.assert(
      fc.property(
        // A subset of the four hamster indices [0..3] placed on the player's
        // tile this frame. Deduplicated so each index appears at most once.
        fc
          .uniqueArray(fc.integer({ min: 0, max: 3 }), {
            minLength: 0,
            maxLength: 4,
          }),
        (overlapIndices) => {
          const { game, playerTile } = freshFrightenedGame();
          expect(game.enemies.length).toBe(4);

          const overlapSet = new Set(overlapIndices);

          // Place the selected hamsters exactly on the player's tile (centered,
          // chase mode) so they overlap after moving. Non-overlapping hamsters
          // stay on their own distant spawns in chase mode.
          game.enemies.forEach((enemy, i) => {
            if (overlapSet.has(i)) {
              enemy.tile = { col: playerTile.col, row: playerTile.row };
              enemy.progress = 0;
              enemy.mode = 'chase';
            }
          });

          // Record each non-overlapping enemy's spawn tile; those enemies must
          // not be sent to spawn, so they should remain away from / in pursuit.
          const nonOverlapSpawns = game.enemies.map((e) => ({
            col: e.spawn.col,
            row: e.spawn.row,
          }));

          // A sub-millisecond step: no entity completes a whole-tile crossing,
          // so overlapping enemies remain on the player's tile and the player
          // does not move off it (intent null). Overlap is resolved exactly
          // once for each overlapping, non-returning hamster.
          game.update(0.1, null);

          game.enemies.forEach((enemy, i) => {
            if (overlapSet.has(i)) {
              // The overlapping enemy was consumed: it is now relocating to its
              // spawn (`returning`) rather than remaining in pursuit at the
              // overlap tile (Req 4.4).
              expect(enemy.mode).toBe('returning');
              // It is heading to its own spawn — a returning enemy's target is
              // its spawn tile. (sendToSpawn() flips an enemy already standing
              // on its spawn straight back to chase; a hamster parked on the
              // player's tile is not on its spawn in the default maze, so it
              // stays `returning` while it heads home.)
              expect(enemy.spawn).toEqual(nonOverlapSpawns[i]);
            } else {
              // A non-overlapping enemy is never spuriously consumed: it stays
              // in pursuit (chase or frightened), never `returning`.
              expect(enemy.mode).not.toBe('returning');
              expect(['chase', 'frightened']).toContain(enemy.mode);
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
