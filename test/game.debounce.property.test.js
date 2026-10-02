// test/game.debounce.property.test.js
//
// Property-based test for the non-fatal collision debounce in the Game
// simulation hub (task 9.10).
//
// Covers design Property 15 "A non-fatal collision decreases lives by exactly
// one, with debounce": a life-losing collision registered outside the 1500 ms
// debounce window decreases lives by exactly one and opens a fresh window; a
// second overlap registered within that window is ignored (total decrease is
// one, not two); and once the window has elapsed (>= 1500 ms) a fresh overlap
// decreases lives again (Req 5.2, 5.3).
//
// To isolate the debounce rule from movement confounds we drive a real Game
// through its public `update`, but:
//   - stage positions directly on the entities and keep the player stationary
//     (dir/requestedDir/bufferedDir null, intent null) so it never leaves its
//     staged tile;
//   - advance with tiny fixed steps so no entity crosses a whole tile within an
//     update (logical `tile` only changes on a full-tile crossing), keeping the
//     staged overlap stable across the collision evaluation;
//   - clear any collectible on the player's tile so pellet/power-pellet side
//     effects cannot flip the Frightened flag or trigger a win;
//   - keep lives at START_LIVES (3) so a single decrease leaves lives >= 1,
//     which triggers a respawn (characters repositioned) rather than a loss.
//     Because respawn repositions the player and enemies, we re-stage the
//     overlap before every subsequent collision we want to register.
//
// Validates: Requirements 5.2, 5.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

/**
 * Collect every open (non-wall) path tile of a game's maze. These are the tiles
 * an entity can legally occupy, so we draw staging positions from here.
 * @param {Game} game
 * @returns {{col:number,row:number}[]}
 */
function openTiles(game) {
  const maze = game.maze;
  const tiles = [];
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (!maze.isWall(col, row)) tiles.push({ col, row });
    }
  }
  return tiles;
}

/**
 * Pin an entity (player or enemy) to a tile and freeze it in place: it sits
 * centered on the tile with no direction, so a subsequent tiny update cannot
 * move it off that tile. Clears buffered input on the player too.
 * @param {{tile:{col:number,row:number},dir:any,progress:number,requestedDir?:any,bufferedDir?:any,bufferAgeMs?:number,mode?:any}} entity
 * @param {{col:number,row:number}} tile
 * @returns {void}
 */
function pinTo(entity, tile) {
  entity.tile = { col: tile.col, row: tile.row };
  entity.dir = null;
  entity.progress = 0;
  if ('requestedDir' in entity) entity.requestedDir = null;
  if ('bufferedDir' in entity) entity.bufferedDir = null;
  if ('bufferAgeMs' in entity) entity.bufferAgeMs = 0;
}

/**
 * Stage a life-losing overlap on a fresh (or respawned) game: clear any
 * collectible under the player's tile, pin the stationary player there, and pin
 * the first enemy onto the same tile in chase mode (so it is a true life-losing
 * overlap, not a consumable/returning one). The remaining enemies are parked on
 * distinct tiles that are not the player's, so they cannot cause a spurious
 * overlap of their own.
 * @param {Game} game
 * @param {{col:number,row:number}} playerTile
 * @param {{col:number,row:number}[]} awayTiles enough distinct non-player tiles
 *   for every enemy after the first.
 * @returns {void}
 */
function stageOverlap(game, playerTile, awayTiles) {
  game.maze.removePellet(playerTile.col, playerTile.row);
  game.maze.removePowerPellet(playerTile.col, playerTile.row);
  pinTo(game.player, playerTile);
  game.enemies.forEach((enemy, i) => {
    if (i === 0) {
      pinTo(enemy, playerTile);
    } else {
      pinTo(enemy, awayTiles[i - 1]);
    }
    enemy.mode = 'chase';
  });
}

// Feature: pacman-hamster, Property 15: A non-fatal collision decreases lives by exactly one, with debounce
describe('Property 15: A non-fatal collision decreases lives by exactly one, with debounce', () => {
  it('decreases lives by exactly one per non-fatal collision; suppresses a second within the window; allows a fresh one after it elapses', () => {
    // One shared template to read the open-tile set and enemy count from; every
    // trial builds a fresh Game so trials cannot leak state.
    const template = new Game();
    const tiles = openTiles(template);
    const enemyCount = template.enemies.length;
    // Need the player's tile plus one distinct away tile per non-first enemy.
    expect(tiles.length).toBeGreaterThan(enemyCount + 1);

    fc.assert(
      fc.property(
        // Which open tile the player (and the colliding enemy) sit on.
        fc.nat({ max: tiles.length - 1 }),
        // A small gap (< debounce window) separating the first and second
        // collisions. The first collision already consumed a 1 ms step, so the
        // second overlap must fall strictly within the remaining window:
        // 1 + gapMs < COLLISION_DEBOUNCE_MS. Capping gapMs at
        // COLLISION_DEBOUNCE_MS - 2 keeps gapMs <= 1498, so 1 + gapMs <= 1499 < 1500.
        fc.integer({ min: 1, max: CONFIG.COLLISION_DEBOUNCE_MS - 2 }),
        // A pool of indices used to scatter the non-colliding enemies onto
        // distinct, non-player tiles.
        fc.array(fc.nat({ max: tiles.length - 1 }), {
          minLength: Math.max(0, enemyCount - 1),
          maxLength: Math.max(0, enemyCount - 1),
        }),
        (playerIdx, gapMs, scatter) => {
          const game = new Game();
          game.start();

          const playerTile = tiles[playerIdx];

          // Build distinct away tiles for the non-first enemies, none equal to
          // the player's tile.
          const used = new Set([`${playerTile.col},${playerTile.row}`]);
          const awayTiles = [];
          let scanFrom = 0;
          const nextFreeTile = (preferIdx) => {
            const tryTile = (t) => {
              const key = `${t.col},${t.row}`;
              if (used.has(key)) return null;
              used.add(key);
              return t;
            };
            const preferred = tryTile(tiles[preferIdx]);
            if (preferred) return preferred;
            while (scanFrom < tiles.length) {
              const t = tryTile(tiles[scanFrom++]);
              if (t) return t;
            }
            return null; // unreachable: tiles.length > enemyCount + 1
          };
          for (let i = 0; i < enemyCount - 1; i++) {
            awayTiles.push(nextFreeTile(scatter[i]));
          }

          // Precondition: lives start at START_LIVES (3) so each non-fatal
          // collision leaves lives >= 1 and triggers a respawn, not a loss.
          expect(game.lives).toBe(CONFIG.START_LIVES);
          expect(game.lives).toBeGreaterThanOrEqual(3);

          // --- Collision #1: outside the debounce window -------------------
          // No invulnerability window is active (fresh game), so this overlap
          // registers: lives decrease by exactly one and a 1500 ms window opens
          // (Req 5.2, 5.3). A 1 ms step keeps the staged overlap stable and
          // leaves the window essentially full (1500 - 1 ms).
          stageOverlap(game, playerTile, awayTiles);
          game._invulnerableMs = 0;
          const livesBeforeFirst = game.lives;

          game.update(1, null);

          expect(game.lives).toBe(livesBeforeFirst - 1);
          // The window is now open (just below the full 1500 ms after the step).
          expect(game._invulnerableMs).toBeGreaterThan(0);
          // Survived, so characters were repositioned to spawn (Req 5.4).

          // --- Collision #2: within the debounce window --------------------
          // Re-stage the overlap (respawn moved everyone) and advance by a gap
          // strictly less than the window. The debounce decrement runs before
          // the collision check, so the window is still open and this overlap
          // is ignored: lives do NOT decrease again. Total decrease stays one.
          stageOverlap(game, playerTile, awayTiles);
          const livesBeforeSecond = game.lives;
          // Window must still be open after advancing the gap: it was ~1500 ms
          // and we advance strictly less than that total so far (1 + gapMs can
          // be < 1500 since gapMs <= 1498).
          expect(1 + gapMs).toBeLessThan(CONFIG.COLLISION_DEBOUNCE_MS);

          game.update(gapMs, null);

          expect(game.lives).toBe(livesBeforeSecond);
          // Net effect of the pair: exactly one life lost, not two.
          expect(livesBeforeFirst - game.lives).toBe(1);

          // --- Collision #3: after the window elapses ----------------------
          // Advance past the remainder of the window with a stationary,
          // non-overlapping board so no collision registers while the window
          // drains, then re-stage the overlap. With the window closed, a fresh
          // overlap registers and lives decrease again (Req 5.3).
          //
          // Drain the remaining window with a stationary, non-overlapping
          // board. The enemy AI moves enemies during each update, so to keep
          // the drain collision-free we re-pin the player and every enemy onto
          // distinct, mutually non-overlapping tiles BEFORE each drain step.
          // We give every enemy its own distinct tile (the player's tile plus
          // one per enemy are all distinct open tiles).
          const drainTiles = [];
          {
            const dUsed = new Set([`${playerTile.col},${playerTile.row}`]);
            let dScan = 0;
            while (drainTiles.length < game.enemies.length && dScan < tiles.length) {
              const t = tiles[dScan++];
              const key = `${t.col},${t.row}`;
              if (!dUsed.has(key)) {
                dUsed.add(key);
                drainTiles.push(t);
              }
            }
          }
          let guard = 0;
          while (game._invulnerableMs > 0 && guard < 10000) {
            // Re-pin before every step so AI movement cannot create an overlap.
            pinTo(game.player, playerTile);
            game.maze.removePellet(playerTile.col, playerTile.row);
            game.maze.removePowerPellet(playerTile.col, playerTile.row);
            game.enemies.forEach((enemy, i) => {
              pinTo(enemy, drainTiles[i]);
              enemy.mode = 'chase';
            });
            game.update(100, null);
            guard++;
          }
          expect(game._invulnerableMs).toBe(0);
          // Draining with no overlap must not have cost any life.
          expect(game.lives).toBe(livesBeforeSecond);

          // Now a fresh overlap outside the window registers again.
          stageOverlap(game, playerTile, awayTiles);
          const livesBeforeThird = game.lives;

          game.update(1, null);

          expect(game.lives).toBe(livesBeforeThird - 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
