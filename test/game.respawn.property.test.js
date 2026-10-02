// test/game.respawn.property.test.js
//
// Property-based test for surviving-collision respawn on the Game simulation
// hub (task 9.11).
//
// Covers design Property 16 "Surviving a collision returns all characters to
// spawn": for every life-losing collision after which lives remain >= 1, the
// player and every hamster enemy are repositioned to their defined spawn tiles
// (the maze's player spawn and each hamster's own spawn).
//
// The test drives the real Game.update path (no mocking):
//   - start a game and set lives to a value (2 or 3) that guarantees survival
//     after one life is lost;
//   - move the player and every enemy away from their spawn tiles so a respawn
//     is observable (their tiles genuinely change);
//   - stage an overlap collision outside Frightened state and outside the
//     debounce window (exactly one enemy, chosen by the generator, shares the
//     player's tile);
//   - clear any collectible on the staging tile so the pellet/power-pellet/win
//     branches cannot perturb the collision evaluation;
//   - take a tiny (1 ms) step so no entity completes a whole-tile crossing, so
//     the staged overlap holds through the collision check;
//   - assert lives dropped to >= 1 and that the player and every enemy are back
//     on their spawn tiles.
//
// Validates: Requirements 5.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

/**
 * Collect every open (non-wall) path tile of a game's maze. These are the tiles
 * an entity can legally occupy, so staging positions are drawn from here.
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

/**
 * Whether two tiles are the same cell.
 * @param {{col:number,row:number}} a
 * @param {{col:number,row:number}} b
 * @returns {boolean}
 */
function sameCell(a, b) {
  return a.col === b.col && a.row === b.row;
}

// Feature: pacman-hamster, Property 16: Surviving a collision returns all characters to spawn
describe('Property 16: Surviving a collision returns all characters to spawn', () => {
  it('repositions the player and every enemy to their spawn tiles after a survived collision', () => {
    const template = new Game();
    const tiles = openTiles(template);
    const enemyCount = template.enemies.length;
    // Need enough distinct open tiles to place the player plus every enemy
    // away from one another.
    expect(tiles.length).toBeGreaterThan(enemyCount + 1);

    fc.assert(
      fc.property(
        // Which open tile the player is pinned to (its "away from spawn" tile).
        fc.nat({ max: tiles.length - 1 }),
        // Which enemy overlaps the player's tile to trigger the collision.
        fc.nat({ max: enemyCount - 1 }),
        // Starting lives after one loss still survives: 2 -> 1, or 3 -> 2.
        fc.constantFrom(2, 3),
        // Index pool used to scatter the non-overlapping enemies to distinct,
        // off-spawn, non-player tiles.
        fc.array(fc.nat({ max: tiles.length - 1 }), {
          minLength: enemyCount,
          maxLength: enemyCount,
        }),
        (playerIdx, overlapEnemy, startLives, scatter) => {
          const game = new Game();
          game.start(); // ready -> playing

          const playerSpawn = game.maze.playerSpawn;
          const hamsterSpawns = game.maze.hamsterSpawns;
          expect(hamsterSpawns.length).toBe(enemyCount);

          const playerTile = tiles[playerIdx];

          // Clear any collectible on the player's staging tile so pellet /
          // power-pellet consumption cannot flip Frightened or trigger a win
          // and perturb the collision evaluation under study.
          game.maze.removePellet(playerTile.col, playerTile.row);
          game.maze.removePowerPellet(playerTile.col, playerTile.row);

          // Pin the player, stationary, on its away tile.
          pinTo(game.player, playerTile);

          // Choose distinct away tiles for the non-overlapping enemies, none
          // equal to the player's tile.
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

          // Position every enemy. The chosen overlap enemy sits on the player's
          // tile (triggering the collision); the rest scatter to distinct away
          // tiles. All stay in `chase` so the overlap is a true life-losing
          // collision rather than a frightened consumption.
          game.enemies.forEach((enemy, i) => {
            if (i === overlapEnemy) {
              pinTo(enemy, playerTile);
            } else {
              pinTo(enemy, nextFreeTile(scatter[i]));
            }
            enemy.mode = 'chase';
          });

          // Survive the loss: set lives so that losing exactly one still leaves
          // at least one life. No Frightened, no debounce window.
          game._lives = startLives;
          game._frightened.active = false;
          game._frightened.remainingMs = 0;
          game._invulnerableMs = 0;

          const livesBefore = game.lives;

          // A single tiny step: 1 ms is far below one tile-crossing at the
          // configured speeds, so the staged overlap holds and the collision is
          // registered this update.
          game.update(1, null);

          // The collision cost exactly one life and the game survived.
          expect(game.lives).toBe(livesBefore - 1);
          expect(game.lives).toBeGreaterThanOrEqual(1);
          expect(game.mode).toBe('playing');

          // Property 16: the player is back on the maze's player spawn and
          // every enemy is back on its own hamster spawn (Req 5.4).
          expect(sameCell(game.player.tile, playerSpawn)).toBe(true);
          game.enemies.forEach((enemy, i) => {
            expect(sameCell(enemy.tile, hamsterSpawns[i])).toBe(true);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
