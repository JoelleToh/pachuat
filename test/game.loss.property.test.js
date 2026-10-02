// test/game.loss.property.test.js
//
// Property-based test for the loss transition in the Game simulation hub
// (task 9.12).
//
// Covers design Property 17 "Losing the last life ends the session": for all
// collisions that bring lives to zero, the game mode transitions to 'lost'.
//
// A life-losing collision occurs during an update when the player shares a tile
// with an enemy, the game is not Frightened, and no debounce/invulnerability
// window is active (Req 3.9, 5.2, 5.3). When that collision drops lives to 0
// the session ends: mode becomes 'lost' and further input is rejected
// (Req 5.5, 5.6).
//
// To isolate the loss rule from movement confounds we drive a real Game through
// its public `update`, but:
//   - set lives to exactly 1 so the staged collision is fatal;
//   - ensure the game is not Frightened and the invulnerability window is 0, so
//     the overlap registers as a collision rather than an enemy consumption or
//     a debounced no-op;
//   - stage positions directly on the entities and take a tiny step (1 ms) so
//     no entity crosses a whole tile within the update (logical `tile` only
//     changes on a full-tile crossing), keeping the staged overlap stable;
//   - keep the player stationary (dir/requestedDir/buffered null, intent null)
//     so it never leaves the staged tile;
//   - clear any collectible on the player's tile so pellet/power-pellet side
//     effects cannot flip the Frightened flag or trigger a win.
//
// We vary which enemy overlaps the player and the player's tile across the
// maze's open path tiles.
//
// Validates: Requirements 5.5

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

// Feature: pacman-hamster, Property 17: Losing the last life ends the session
describe('Property 17: Losing the last life ends the session', () => {
  it('transitions mode to lost and lives to 0 when a collision drains the last life', () => {
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
        // Which enemy is placed on top of the player (varies the overlapping
        // enemy across all four hamsters).
        fc.nat({ max: enemyCount - 1 }),
        // A pool of indices used to scatter the non-overlapping enemies onto
        // distinct, non-player tiles (so only the chosen enemy overlaps).
        fc.array(fc.nat({ max: tiles.length - 1 }), {
          minLength: enemyCount,
          maxLength: enemyCount,
        }),
        (playerIdx, overlapEnemyIdx, scatter) => {
          const game = new Game();
          game.start();

          const playerTile = tiles[playerIdx];

          // Remove any collectible on the player's tile so pellet/power-pellet
          // consumption cannot flip the Frightened flag or trigger a win and
          // perturb the collision/loss evaluation we are isolating.
          game.maze.removePellet(playerTile.col, playerTile.row);
          game.maze.removePowerPellet(playerTile.col, playerTile.row);

          // Pin the player, stationary, on its tile.
          pinTo(game.player, playerTile);

          // Build a set of distinct tiles for the non-overlapping enemies, none
          // equal to the player's tile. Walk the shuffled index pool and fall
          // back to scanning for the next free tile if a slot repeats.
          const used = new Set([`${playerTile.col},${playerTile.row}`]);
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

          // Place the chosen enemy on the player's tile; scatter the rest onto
          // distinct away tiles. Keep every enemy in `chase` so the overlap is
          // a true life-losing collision (returning enemies are skipped).
          game.enemies.forEach((enemy, i) => {
            if (i === overlapEnemyIdx) {
              pinTo(enemy, playerTile);
            } else {
              pinTo(enemy, nextFreeTile(scatter[i]));
            }
            enemy.mode = 'chase';
          });

          // Set up the fatal conditions: exactly one life left, not Frightened,
          // and no active invulnerability window so the overlap registers as a
          // collision this step.
          game._lives = 1;
          game._frightened.active = false;
          game._frightened.remainingMs = 0;
          game._invulnerableMs = 0;

          // A single tiny fixed step: 1 ms is far below one tile-crossing at
          // the configured speeds, so no entity changes its logical tile and
          // the staged overlap holds through the collision evaluation.
          game.update(1, null);

          // Losing the last life ends the session (Req 5.5): lives reach 0 and
          // the mode transitions to 'lost'.
          expect(game.lives).toBe(0);
          expect(game.mode).toBe('lost');
        }
      ),
      { numRuns: 100 }
    );
  });
});
