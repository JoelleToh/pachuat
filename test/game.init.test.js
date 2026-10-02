// test/game.init.test.js
//
// Unit tests for Game initialization (task 9.17). A freshly constructed Game
// must start the player at the maze's player spawn with the full set of
// collectibles present (Req 1.1), place exactly four hamster enemies at the
// four hamster spawns (Req 3.1), and begin with lives === START_LIVES (3) and
// score 0 (Req 5.1). We also confirm the mode machine: construction yields
// `ready` and start() advances to `playing` (Req 9.5).
//
// Requirements: 1.1, 3.1, 5.1

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';

/**
 * Independently tally the collectibles in a layout by directly counting the
 * `.` (pellet) and `o` (power pellet) characters, string by string. This does
 * not reuse any of the Maze's internal grid traversal, so it is a genuine
 * cross-check of `remainingCollectibles()`.
 * @param {ReadonlyArray<string>} layout
 * @returns {number}
 */
function tallyCollectibles(layout) {
  let count = 0;
  for (const row of layout) {
    for (const ch of row) {
      if (ch === '.' || ch === 'o') count++;
    }
  }
  return count;
}

describe('Game — initialization', () => {
  it('places the player at the maze player spawn (Req 1.1)', () => {
    const game = new Game();
    const spawn = game.maze.playerSpawn;

    expect(spawn).not.toBeNull();
    expect(game.player.tile).toEqual({ col: spawn.col, row: spawn.row });
  });

  it('starts with every collectible present, matching an independent tally of the default layout (Req 1.1)', () => {
    const game = new Game();

    const expected = tallyCollectibles(DEFAULT_MAZE_LAYOUT);
    // Sanity: the default maze actually contains collectibles to clear.
    expect(expected).toBeGreaterThan(0);
    expect(game.maze.remainingCollectibles()).toBe(expected);

    // Cross-check against a standalone Maze built from the same layout.
    const standalone = new Maze(DEFAULT_MAZE_LAYOUT);
    expect(game.maze.remainingCollectibles()).toBe(
      standalone.remainingCollectibles()
    );
  });

  it('creates exactly four enemies, one at each hamster spawn (Req 3.1)', () => {
    const game = new Game();
    const spawns = game.maze.hamsterSpawns;

    expect(spawns).toHaveLength(4);
    expect(game.enemies).toHaveLength(4);

    // Every enemy sits on a hamster spawn, and every hamster spawn is occupied
    // by exactly one enemy (a bijection between enemies and spawns).
    const keyOf = (t) => `${t.col},${t.row}`;
    const spawnKeys = spawns.map(keyOf).sort();
    const enemyKeys = game.enemies.map((e) => keyOf(e.tile)).sort();

    expect(enemyKeys).toEqual(spawnKeys);
  });

  it('starts with lives === 3 and score === 0 (Req 5.1)', () => {
    const game = new Game();

    expect(game.lives).toBe(3);
    expect(game.lives).toBe(game.config.START_LIVES);
    expect(game.score).toBe(0);
    expect(game.frightened).toBe(false);
  });

  it('begins in the `ready` mode and start() moves to `playing` (Req 9.5)', () => {
    const game = new Game();

    expect(game.mode).toBe('ready');
    game.start();
    expect(game.mode).toBe('playing');
  });
});
