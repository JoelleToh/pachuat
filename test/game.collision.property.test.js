// test/game.collision.property.test.js
//
// Property-based test for collision registration in the Game simulation hub
// (task 9.6).
//
// Covers design Property 11 "Collision is registered exactly when overlapping
// outside Frightened state": a life-losing collision between the player and an
// enemy is registered during an update iff the player shares a tile with some
// enemy AND the game is not Frightened AND no debounce/invulnerability window
// is active. While Frightened, an overlap consumes the enemy (sends it to
// spawn, awards points) rather than costing a life; with no overlap nothing
// happens; inside the debounce window a would-be collision is suppressed.
//
// To isolate the collision rule from movement confounds we drive a real Game
// through its public `update`, but:
//   - stage positions directly on the entities and take a tiny step (1 ms) so
//     no entity crosses a whole tile within the update (tile identity is stable
//     across the step: logical `tile` only changes on a full-tile crossing);
//   - keep the player stationary (dir/requestedDir/buffered null, intent null)
//     so it never leaves the staged tile;
//   - place the maze's player spawn tile under study as a plain, pellet-free
//     path tile would be — we clear any collectible there so pellet/power-pellet
//     side effects cannot perturb the Frightened flag or the win check.
//
// We vary the three independent conditions (overlap vs none, Frightened vs not,
// debounce active vs not) and assert a life is lost on this update exactly when
// overlap && !frightened && !debounced; and specifically that an overlap while
// Frightened costs no life (the enemy is consumed instead) and that no overlap
// never costs a life.
//
// Validates: Requirements 3.9

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
 * @param {{tile:{col:number,row:number},dir:any,progress:number,requestedDir?:any,bufferedDir?:any,bufferAgeMs?:number}} entity
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

// Feature: pacman-hamster, Property 11: Collision is registered exactly when overlapping outside Frightened state
describe('Property 11: Collision is registered exactly when overlapping outside Frightened state', () => {
  it('loses a life on this update iff player overlaps an enemy AND not frightened AND not debounced', () => {
    // One shared Game template to read the open-tile set and enemy count from;
    // every trial constructs a fresh Game so trials cannot leak state.
    const template = new Game();
    const tiles = openTiles(template);
    const enemyCount = template.enemies.length;
    expect(tiles.length).toBeGreaterThan(enemyCount + 1);

    fc.assert(
      fc.property(
        // Which open tile the player is pinned to.
        fc.nat({ max: tiles.length - 1 }),
        // The three independent conditions under test.
        fc.boolean(), // overlap: does one enemy share the player's tile?
        fc.boolean(), // frightened: is the game in Frightened state?
        fc.boolean(), // debounced: is an invulnerability window active?
        // A pool of indices used to scatter the non-overlapping enemies onto
        // distinct, non-player tiles (so they never cause a spurious overlap).
        fc.array(fc.nat({ max: tiles.length - 1 }), {
          minLength: enemyCount,
          maxLength: enemyCount,
        }),
        (playerIdx, overlap, frightened, debounced, scatter) => {
          const game = new Game();
          game.start();

          const playerTile = tiles[playerIdx];

          // Remove any collectible on the player's tile so pellet/power-pellet
          // consumption cannot flip the Frightened flag or trigger a win and
          // perturb the collision evaluation we are isolating.
          game.maze.removePellet(playerTile.col, playerTile.row);
          game.maze.removePowerPellet(playerTile.col, playerTile.row);

          // Pin the player, stationary, on its tile.
          pinTo(game.player, playerTile);

          // Build a set of distinct tiles for the non-overlapping enemies,
          // none equal to the player's tile. Walk the shuffled index pool and
          // fall back to scanning for the next free tile if a slot repeats.
          const used = new Set([`${playerTile.col},${playerTile.row}`]);
          const awayTiles = [];
          let scanFrom = 0;
          const nextFreeTile = (preferIdx) => {
            const tryTile = (t) => {
              const key = `${t.col},${t.row}`;
              if (!used.has(key)) {
                used.add(key);
                return t;
              }
              return null;
            };
            const preferred = tryTile(tiles[preferIdx]);
            if (preferred) return preferred;
            while (scanFrom < tiles.length) {
              const t = tryTile(tiles[scanFrom++]);
              if (t) return t;
            }
            return null; // unreachable: tiles.length > enemyCount + 1
          };
          for (let i = 0; i < game.enemies.length; i++) {
            awayTiles.push(nextFreeTile(scatter[i]));
          }

          // Decide where each enemy sits. In the overlap case exactly one
          // enemy (the first) is pinned onto the player's tile; the rest go to
          // their distinct away tiles. In the no-overlap case all enemies sit
          // on away tiles.
          game.enemies.forEach((enemy, i) => {
            if (overlap && i === 0) {
              pinTo(enemy, playerTile);
            } else {
              pinTo(enemy, awayTiles[i]);
            }
            // Keep enemies out of `returning` so a frightened overlap is a true
            // consumable overlap (returning enemies are skipped by both the
            // consumption and collision checks).
            enemy.mode = 'chase';
          });

          // Apply the Frightened and debounce conditions directly on the
          // game's internal state.
          game._frightened.active = frightened;
          game._frightened.remainingMs = frightened ? CONFIG.FRIGHTENED_MS : 0;
          game._invulnerableMs = debounced ? CONFIG.COLLISION_DEBOUNCE_MS : 0;

          const livesBefore = game.lives;

          // A single tiny fixed step: 1 ms is far below one tile-crossing at
          // the configured speeds, so no entity changes its logical tile and
          // the staged overlap/no-overlap relationship holds through the
          // collision evaluation.
          game.update(1, null);

          const lostLife = game.lives === livesBefore - 1;

          // The exact collision-registration condition from Req 3.9 (plus the
          // debounce guard from the surrounding behavior): a life is lost iff
          // the player overlapped an enemy, the game was not Frightened, and no
          // invulnerability window was active.
          const expectLifeLost = overlap && !frightened && !debounced;

          expect(lostLife).toBe(expectLifeLost);

          // Reinforce the two headline sub-cases:
          // - Frightened overlap must never cost a life (the enemy is consumed
          //   instead), regardless of debounce.
          if (overlap && frightened) {
            expect(game.lives).toBe(livesBefore);
          }
          // - No overlap must never cost a life, regardless of the other flags.
          if (!overlap) {
            expect(game.lives).toBe(livesBefore);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
