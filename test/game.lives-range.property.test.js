// test/game.lives-range.property.test.js
//
// Property-based test for the lives invariant in the Game simulation hub
// (task 9.13).
//
// Covers design Property 18 "Lives stay within range": for every sequence of
// collisions and restarts, the lives count never leaves the inclusive range
// 0..START_LIVES (3). This mirrors Req 5.7 (the HUD displays lives as an
// integer in 0..3) by guaranteeing the underlying state the HUD reads can only
// ever fall in that band: a collision decreases lives by at most one and clamps
// at 0, and a restart resets lives to START_LIVES.
//
// We drive a real Game through its public API across a randomly generated
// program of two kinds of operations and assert the invariant after EACH one:
//
//   - 'collision': stage a life-losing overlap (one enemy pinned on top of a
//     stationary player, not Frightened, invulnerability window cleared) and
//     take one tiny fixed step so the overlap holds through collision
//     evaluation. This exercises the decrease-by-one / clamp-at-0 path and the
//     survive-vs-loss branches (Req 5.2, 5.4, 5.5).
//   - 'restart': call restart(), which rebuilds a fresh session with lives back
//     at START_LIVES (Req 6.4) and mode 'ready', then start() to resume play.
//
// A collision while the game is already 'lost' is a no-op (ended games reject
// input and advance nothing), so the sequence naturally mixes effective and
// ineffective collisions; the invariant must hold throughout regardless.
//
// Validates: Requirements 5.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

/**
 * Collect every open (non-wall) path tile of a game's maze — the tiles an
 * entity can legally occupy, used as staging positions.
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
 * Pin an entity to a tile and freeze it: centered on the tile with no
 * direction, so a subsequent tiny update cannot move it off that tile. Clears
 * buffered input on the player too.
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
 * Stage and apply one life-losing collision on `game`: pin the player onto a
 * free tile (collectibles cleared so no Frightened/win side effects), pin the
 * chosen enemy on top of it, scatter the rest onto distinct away tiles, clear
 * the Frightened state and invulnerability window, and take one tiny fixed
 * step so the overlap holds through collision evaluation. If the game is not
 * currently 'playing' (e.g. already 'lost') the update is a no-op by design.
 * @param {Game} game
 * @param {{col:number,row:number}[]} tiles
 * @param {number} playerIdx
 * @param {number} overlapEnemyIdx
 * @param {number[]} scatter
 * @returns {void}
 */
function stageCollision(game, tiles, playerIdx, overlapEnemyIdx, scatter) {
  const playerTile = tiles[playerIdx % tiles.length];

  // Remove any collectible on the player's tile so pellet/power-pellet
  // consumption cannot flip the Frightened flag or trigger a win.
  game.maze.removePellet(playerTile.col, playerTile.row);
  game.maze.removePowerPellet(playerTile.col, playerTile.row);

  pinTo(game.player, playerTile);

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
    const preferred = tryTile(tiles[preferIdx % tiles.length]);
    if (preferred) return preferred;
    while (scanFrom < tiles.length) {
      const t = tryTile(tiles[scanFrom++]);
      if (t) return t;
    }
    return playerTile; // unreachable: tiles.length > enemyCount + 1
  };

  const overlap = overlapEnemyIdx % game.enemies.length;
  game.enemies.forEach((enemy, i) => {
    if (i === overlap) {
      pinTo(enemy, playerTile);
    } else {
      pinTo(enemy, nextFreeTile(scatter[i] ?? i));
    }
    enemy.mode = 'chase';
  });

  // Fatal conditions: not Frightened, no active invulnerability window, so the
  // overlap registers as a collision this step.
  game._frightened.active = false;
  game._frightened.remainingMs = 0;
  game._invulnerableMs = 0;

  // One tiny fixed step: 1 ms is far below one tile-crossing, so no entity
  // changes its logical tile and the staged overlap holds.
  game.update(1, null);
}

// Feature: pacman-hamster, Property 18: Lives stay within range
describe('Property 18: Lives stay within range', () => {
  it('keeps lives within 0..START_LIVES across any sequence of collisions and restarts', () => {
    const template = new Game();
    const tiles = openTiles(template);
    const enemyCount = template.enemies.length;
    expect(tiles.length).toBeGreaterThan(enemyCount + 1);

    // An operation is either a staged collision (with the staging parameters it
    // needs) or a restart. We generate an arbitrary-length program of these.
    const collisionOp = fc.record({
      kind: fc.constant('collision'),
      playerIdx: fc.nat({ max: tiles.length - 1 }),
      overlapEnemyIdx: fc.nat({ max: enemyCount - 1 }),
      scatter: fc.array(fc.nat({ max: tiles.length - 1 }), {
        minLength: enemyCount,
        maxLength: enemyCount,
      }),
    });
    const restartOp = fc.record({ kind: fc.constant('restart') });

    fc.assert(
      fc.property(
        fc.array(fc.oneof(collisionOp, restartOp), {
          minLength: 1,
          maxLength: 30,
        }),
        (program) => {
          const game = new Game();
          game.start();

          // Invariant holds from the start: a fresh game has full lives.
          expect(game.lives).toBe(CONFIG.START_LIVES);

          for (const op of program) {
            if (op.kind === 'collision') {
              stageCollision(
                game,
                tiles,
                op.playerIdx,
                op.overlapEnemyIdx,
                op.scatter
              );
            } else {
              game.restart();
              game.start();
            }

            // After EVERY operation the lives count must remain an integer in
            // the inclusive range 0..START_LIVES (Req 5.7).
            expect(Number.isInteger(game.lives)).toBe(true);
            expect(game.lives).toBeGreaterThanOrEqual(0);
            expect(game.lives).toBeLessThanOrEqual(CONFIG.START_LIVES);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
