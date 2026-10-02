// test/game.restart.property.test.js
//
// Property-based test for restart producing a fresh session on the Game
// simulation hub (task 9.16).
//
// Covers design Property 21 "Restart yields a fresh session": for all ended
// games (won or lost), performing a restart produces a state equal to a freshly
// started session. Concretely, after restart() the maze holds its full set of
// pellets and power pellets, the score is 0, lives is START_LIVES (3), every
// character sits on its spawn tile, and the Frightened sub-state is inactive.
//
// Game.restart() rebuilds a fresh session equal to a newly constructed Game
// awaiting start(): it resets the maze, re-initializes run state, respawns all
// characters, and sets the mode to 'ready' (NOT 'won'/'lost'/'playing'). So the
// restarted state is compared against a fresh `new Game()` as the oracle.
//
// Strategy: build a Game and drive it into an ended state (either 'won' by
// clearing every collectible, or 'lost' by staging a fatal collision), then
// scramble the mutable run state (score, lives, Frightened, invulnerability
// window) and move characters off their spawn tiles. Calling restart() must
// then collapse everything back to the fresh-session baseline regardless of how
// the game ended or how badly its state was perturbed. The chosen end outcome
// and the perturbation magnitudes are generated so many distinct ended games
// are exercised.
//
// Validates: Requirements 6.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

// Fixed simulation step (ms) matching SIM_HZ (60 Hz) used across the sim.
const STEP_MS = 1000 / 60;

/**
 * The full count of collectibles (pellets + power pellets) a fresh maze holds.
 * Derived from a pristine Game so the assertion target is the real baseline.
 */
const FRESH_COLLECTIBLES = new Game().maze.remainingCollectibles();

/**
 * Drive a game into the 'won' state by clearing every collectible directly
 * through the public removal path, then taking one update so the win edge in
 * Game.update() fires.
 * @param {Game} game A started game.
 * @returns {void}
 */
function driveToWon(game) {
  const maze = game.maze;
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      maze.removePellet(col, row);
      maze.removePowerPellet(col, row);
    }
  }
  // One step with the player sitting on a now-empty tile drives the combined
  // remaining count to 0 and transitions the mode to 'won'.
  game.update(STEP_MS, null);
}

/**
 * Drive a game into the 'lost' state by staging a fatal collision: pin the
 * player and one enemy onto the same tile with exactly one life left, no
 * Frightened state, and no active debounce window, then take a 1 ms step so the
 * overlap registers as the final life-losing collision.
 * @param {Game} game A started game.
 * @returns {void}
 */
function driveToLost(game) {
  const spawn = game.maze.playerSpawn;
  // Clear any collectible on the staging tile so consumption cannot flip the
  // Frightened flag or trigger a win and perturb the collision evaluation.
  game.maze.removePellet(spawn.col, spawn.row);
  game.maze.removePowerPellet(spawn.col, spawn.row);

  game.player.tile = { col: spawn.col, row: spawn.row };
  game.player.dir = null;
  game.player.progress = 0;
  game.player.requestedDir = null;
  game.player.bufferedDir = null;

  // Overlap exactly one enemy with the player, in chase mode; scatter is not
  // needed since any single chase-mode overlap outside Frightened is fatal.
  const enemy = game.enemies[0];
  enemy.tile = { col: spawn.col, row: spawn.row };
  enemy.dir = null;
  enemy.progress = 0;
  enemy.mode = 'chase';

  game._lives = 1;
  game._frightened.active = false;
  game._frightened.remainingMs = 0;
  game._invulnerableMs = 0;

  // 1 ms is far below one tile-crossing, so no entity changes its logical tile
  // and the staged overlap holds through the collision evaluation.
  game.update(1, null);
}

// Feature: pacman-hamster, Property 21: Restart yields a fresh session
describe('Property 21: Restart yields a fresh session', () => {
  it('restart() from any ended game yields a state equal to a fresh session (Req 6.4)', () => {
    fc.assert(
      fc.property(
        // Which ended state the game reaches before restart.
        fc.constantFrom('won', 'lost'),
        // Arbitrary score / lives perturbations applied before restart.
        fc.integer({ min: 0, max: CONFIG.SCORE_MAX }),
        fc.integer({ min: 0, max: CONFIG.START_LIVES }),
        // Whether to leave the Frightened sub-state active with some remainder.
        fc.boolean(),
        fc.integer({ min: 1, max: CONFIG.FRIGHTENED_MS }),
        (outcome, score, lives, frightenedActive, frightenedMs) => {
          const game = new Game();
          game.start();

          // Reach an ended state (won or lost).
          if (outcome === 'won') {
            driveToWon(game);
          } else {
            driveToLost(game);
          }
          expect(game.mode).toBe(outcome);

          // Scramble the mutable run state so restart has something to undo:
          // a nonzero/odd score, altered lives, an active Frightened window,
          // and an open invulnerability window.
          game._setScore(score);
          game._lives = lives;
          game._frightened.active = frightenedActive;
          game._frightened.remainingMs = frightenedActive ? frightenedMs : 0;
          game._invulnerableMs = 500;

          // Move characters off their spawns to a non-spawn open tile so the
          // respawn is observable. Any corner-adjacent open path works; use a
          // tile known to differ from the spawns by shifting the player and
          // enemies to each other's / arbitrary tiles.
          const away = findNonSpawnOpenTile(game);
          if (away) {
            game.player.tile = { col: away.col, row: away.row };
            game.player.progress = 0.5;
            for (const enemy of game.enemies) {
              enemy.tile = { col: away.col, row: away.row };
              enemy.progress = 0.25;
            }
          }

          // Restart: collapse everything to the fresh-session baseline.
          game.restart();

          // Oracle: a brand-new, unstarted Game.
          const fresh = new Game();

          // Mode returns to the fresh 'ready' value (read from restart()).
          expect(game.mode).toBe('ready');
          expect(game.mode).toBe(fresh.mode);

          // Maze restored to the full collectible set.
          expect(game.maze.remainingCollectibles()).toBe(FRESH_COLLECTIBLES);
          expect(game.maze.remainingCollectibles()).toBe(
            fresh.maze.remainingCollectibles()
          );

          // Run state reset: score 0, lives START_LIVES (3), Frightened off.
          expect(game.score).toBe(0);
          expect(game.lives).toBe(CONFIG.START_LIVES);
          expect(game.lives).toBe(3);
          expect(game.frightened).toBe(false);
          expect(game.frightenedRemainingMs).toBe(0);

          // Characters back on their spawn tiles.
          expect(game.player.tile).toEqual(game.maze.playerSpawn);
          const spawns = game.maze.hamsterSpawns;
          game.enemies.forEach((enemy, i) => {
            expect(enemy.tile).toEqual(spawns[i]);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Find an open (non-wall) tile that is NOT the player spawn and NOT any hamster
 * spawn, so moving characters there makes the subsequent respawn observable.
 * Returns null only for a degenerate maze with no such tile.
 * @param {Game} game
 * @returns {{col:number,row:number}|null}
 */
function findNonSpawnOpenTile(game) {
  const maze = game.maze;
  const spawnKeys = new Set();
  const ps = maze.playerSpawn;
  if (ps) spawnKeys.add(`${ps.col},${ps.row}`);
  for (const s of maze.hamsterSpawns) spawnKeys.add(`${s.col},${s.row}`);
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (maze.isWall(col, row)) continue;
      if (spawnKeys.has(`${col},${row}`)) continue;
      return { col, row };
    }
  }
  return null;
}
