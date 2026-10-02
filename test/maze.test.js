// test/maze.test.js
//
// Unit tests for the Maze grid model (task 3.4). Covers parsing of a small
// custom layout and the concrete DEFAULT_MAZE_LAYOUT: dimensions, spawn
// locations (1 player P, 4 hamster H), wall/tunnel detection, symmetric
// tunnel partner pairing, pellet/power-pellet counts and queries, the exact
// point values returned by removePellet (10, idempotent 0) and
// removePowerPellet (50), remainingCollectibles decrementing correctly, and
// reset() restoring the full collectible set.
//
// Requirements: 1.1 (maze/spawns), 1.5 (horizontal tunnel wrap), 6.4 (reset
// restores the full pellet set).

import { describe, it, expect } from 'vitest';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';

// A compact, hand-countable layout exercising every tile type:
//   - rectangular 7x5 grid (all rows length 7)
//   - 1 player spawn (P), 4 hamster spawns (H)
//   - a single horizontal tunnel row (T on both edges of row 2)
//   - 3 pellets (.) and 2 power pellets (o)
//
//        col: 0123456
const SMALL_LAYOUT = [
  '#######', // row 0: all walls
  '#o.H.o#', // row 1: power, pellet, hamster, pellet, power
  'TH P HT', // row 2: tunnel edges + 2 hamsters flanking player spawn
  '#..H..#', // row 3: hamster + pellets  (wait: counted below)
  '#######', // row 4: all walls
];
// Pellet/power/spawn tally for SMALL_LAYOUT:
//   row 1: o . H . o   -> power x2, pellet x2, hamster x1
//   row 2: T H _ P _ H T -> tunnel x2, hamster x2, player x1
//   row 3: # . . H . . # -> pellet x4, hamster x1
// Totals: pellets = 2 + 4 = 6, power = 2, hamsters = 1 + 2 + 1 = 4, player = 1.

describe('Maze — small custom layout', () => {
  /** @type {Maze} */
  let maze;

  // Fresh instance per test so mutations (removePellet/reset) don't leak.
  const makeMaze = () => new Maze(SMALL_LAYOUT);

  it('reports width and height from the layout', () => {
    maze = makeMaze();
    expect(maze.width).toBe(7);
    expect(maze.height).toBe(5);
  });

  it('locates exactly one player spawn (Req 1.1)', () => {
    maze = makeMaze();
    expect(maze.playerSpawn).toEqual({ col: 3, row: 2 });
  });

  it('locates exactly four hamster spawns (Req 1.1)', () => {
    maze = makeMaze();
    const spawns = maze.hamsterSpawns;
    expect(spawns).toHaveLength(4);
    expect(spawns).toEqual(
      expect.arrayContaining([
        { col: 3, row: 1 },
        { col: 1, row: 2 },
        { col: 5, row: 2 },
        { col: 3, row: 3 },
      ])
    );
  });

  it('getters return copies that cannot mutate internal state', () => {
    maze = makeMaze();
    const spawn = maze.playerSpawn;
    spawn.col = 999;
    expect(maze.playerSpawn).toEqual({ col: 3, row: 2 });

    const spawns = maze.hamsterSpawns;
    spawns[0].col = 999;
    expect(maze.hamsterSpawns[0].col).not.toBe(999);
  });

  it('detects walls and treats out-of-bounds tiles as walls', () => {
    maze = makeMaze();
    expect(maze.isWall(0, 0)).toBe(true); // border wall
    expect(maze.isWall(0, 4)).toBe(true); // bottom-left wall
    expect(maze.isWall(2, 1)).toBe(false); // a pellet path tile
    expect(maze.isWall(3, 2)).toBe(false); // player spawn (open)
    // out-of-bounds -> wall
    expect(maze.isWall(-1, 0)).toBe(true);
    expect(maze.isWall(7, 0)).toBe(true);
    expect(maze.isWall(0, 5)).toBe(true);
  });

  it('identifies tunnel exit edges (Req 1.5)', () => {
    maze = makeMaze();
    expect(maze.isTunnelExit(0, 2)).toBe(true);
    expect(maze.isTunnelExit(6, 2)).toBe(true);
    // non-tunnel tiles and out-of-bounds are not tunnel exits
    expect(maze.isTunnelExit(3, 2)).toBe(false);
    expect(maze.isTunnelExit(0, 0)).toBe(false);
    expect(maze.isTunnelExit(-1, 2)).toBe(false);
  });

  it('pairs tunnel partners symmetrically on the same row (Req 1.5)', () => {
    maze = makeMaze();
    expect(maze.tunnelPartner(0, 2)).toEqual({ col: 6, row: 2 });
    expect(maze.tunnelPartner(6, 2)).toEqual({ col: 0, row: 2 });
    // non-tunnel tiles have no partner
    expect(maze.tunnelPartner(3, 2)).toBeNull();
    expect(maze.tunnelPartner(0, 0)).toBeNull();
  });

  it('reports pellet and power-pellet presence per tile', () => {
    maze = makeMaze();
    // pellets
    expect(maze.hasPellet(2, 1)).toBe(true);
    expect(maze.hasPellet(4, 1)).toBe(true);
    // power pellets
    expect(maze.hasPowerPellet(1, 1)).toBe(true);
    expect(maze.hasPowerPellet(5, 1)).toBe(true);
    // a wall tile holds neither; a power-pellet tile is not a plain pellet
    expect(maze.hasPellet(1, 1)).toBe(false);
    expect(maze.hasPowerPellet(2, 1)).toBe(false);
    expect(maze.hasPellet(0, 0)).toBe(false);
    // out-of-bounds queries are false
    expect(maze.hasPellet(-1, 0)).toBe(false);
    expect(maze.hasPowerPellet(99, 99)).toBe(false);
  });

  it('counts collectibles as pellets + power pellets (Req 6.1)', () => {
    maze = makeMaze();
    // 6 pellets + 2 power pellets = 8
    expect(maze.remainingCollectibles()).toBe(8);
  });

  it('removePellet returns 10 then 0 (idempotent) and clears the tile', () => {
    maze = makeMaze();
    expect(maze.hasPellet(2, 1)).toBe(true);
    expect(maze.removePellet(2, 1)).toBe(10);
    expect(maze.hasPellet(2, 1)).toBe(false);
    // consuming the now-empty tile is idempotent on score
    expect(maze.removePellet(2, 1)).toBe(0);
    // removing a pellet from a tile that never had one is also 0
    expect(maze.removePellet(0, 0)).toBe(0);
  });

  it('removePowerPellet returns 50 then 0 (idempotent) and clears the tile', () => {
    maze = makeMaze();
    expect(maze.hasPowerPellet(1, 1)).toBe(true);
    expect(maze.removePowerPellet(1, 1)).toBe(50);
    expect(maze.hasPowerPellet(1, 1)).toBe(false);
    expect(maze.removePowerPellet(1, 1)).toBe(0);
    // removePellet on a power-pellet tile does nothing (different collectible)
    expect(maze.removePellet(5, 1)).toBe(0);
    expect(maze.hasPowerPellet(5, 1)).toBe(true);
  });

  it('remainingCollectibles decrements by exactly one per consumed collectible', () => {
    maze = makeMaze();
    expect(maze.remainingCollectibles()).toBe(8);
    maze.removePellet(2, 1);
    expect(maze.remainingCollectibles()).toBe(7);
    maze.removePowerPellet(1, 1);
    expect(maze.remainingCollectibles()).toBe(6);
    // an idempotent re-removal does not change the count
    maze.removePellet(2, 1);
    expect(maze.remainingCollectibles()).toBe(6);
  });

  it('reset() restores the full collectible set (Req 6.4)', () => {
    maze = makeMaze();
    const original = maze.remainingCollectibles();

    // Consume everything we can from the known collectible tiles.
    maze.removePellet(2, 1);
    maze.removePellet(4, 1);
    maze.removePellet(1, 3);
    maze.removePellet(2, 3);
    maze.removePellet(4, 3);
    maze.removePellet(5, 3);
    maze.removePowerPellet(1, 1);
    maze.removePowerPellet(5, 1);
    expect(maze.remainingCollectibles()).toBe(0);

    maze.reset();

    expect(maze.remainingCollectibles()).toBe(original);
    expect(maze.hasPellet(2, 1)).toBe(true);
    expect(maze.hasPowerPellet(1, 1)).toBe(true);
    // walls/tunnels/spawns are unaffected by reset
    expect(maze.isWall(0, 0)).toBe(true);
    expect(maze.isTunnelExit(0, 2)).toBe(true);
    expect(maze.playerSpawn).toEqual({ col: 3, row: 2 });
  });
});

describe('Maze — construction validation', () => {
  it('rejects a non-array or empty layout', () => {
    expect(() => new Maze([])).toThrow();
    expect(() => new Maze('not an array')).toThrow();
  });

  it('rejects rows of unequal length', () => {
    expect(() => new Maze(['###', '##'])).toThrow();
  });

  it('rejects more than one player spawn', () => {
    expect(() => new Maze(['PP'])).toThrow();
  });

  it('rejects unknown layout characters', () => {
    expect(() => new Maze(['#X#'])).toThrow();
  });

  it('rejects a tunnel row that does not have exactly two edges', () => {
    // A single T on a row cannot be paired.
    expect(() => new Maze(['T..', '...'])).toThrow();
  });
});

describe('Maze — DEFAULT_MAZE_LAYOUT', () => {
  /** @type {Maze} */
  let maze;
  const makeMaze = () => new Maze(DEFAULT_MAZE_LAYOUT);

  // Independently tally the shipped layout so expectations are derived, not
  // hand-typed magic numbers.
  const tally = () => {
    let pellets = 0;
    let powerPellets = 0;
    let players = 0;
    let hamsters = 0;
    let tunnels = 0;
    for (const line of DEFAULT_MAZE_LAYOUT) {
      for (const ch of line) {
        if (ch === '.') pellets++;
        else if (ch === 'o') powerPellets++;
        else if (ch === 'P') players++;
        else if (ch === 'H') hamsters++;
        else if (ch === 'T') tunnels++;
      }
    }
    return { pellets, powerPellets, players, hamsters, tunnels };
  };

  it('uses the default layout when no argument is given', () => {
    const defaulted = new Maze();
    const explicit = new Maze(DEFAULT_MAZE_LAYOUT);
    expect(defaulted.width).toBe(explicit.width);
    expect(defaulted.height).toBe(explicit.height);
    expect(defaulted.remainingCollectibles()).toBe(explicit.remainingCollectibles());
  });

  it('has rectangular dimensions matching the layout', () => {
    maze = makeMaze();
    expect(maze.height).toBe(DEFAULT_MAZE_LAYOUT.length);
    expect(maze.width).toBe(DEFAULT_MAZE_LAYOUT[0].length);
    // every row is the declared width
    for (const line of DEFAULT_MAZE_LAYOUT) {
      expect(line.length).toBe(maze.width);
    }
  });

  it('has exactly one player spawn (Req 1.1)', () => {
    maze = makeMaze();
    expect(tally().players).toBe(1);
    expect(maze.playerSpawn).not.toBeNull();
    // the reported spawn is an open (non-wall) tile
    const { col, row } = maze.playerSpawn;
    expect(maze.isWall(col, row)).toBe(false);
  });

  it('has exactly four hamster spawns on open tiles (Req 1.1)', () => {
    maze = makeMaze();
    expect(tally().hamsters).toBe(4);
    const spawns = maze.hamsterSpawns;
    expect(spawns).toHaveLength(4);
    for (const { col, row } of spawns) {
      expect(maze.isWall(col, row)).toBe(false);
    }
  });

  it('has horizontal tunnel edges that pair symmetrically (Req 1.5)', () => {
    maze = makeMaze();
    const { tunnels } = tally();
    // tunnels come in pairs (one per edge of a row)
    expect(tunnels).toBeGreaterThanOrEqual(2);
    expect(tunnels % 2).toBe(0);

    // Every tunnel edge has a partner, the partnership is symmetric, on the
    // same row, and on the opposite horizontal edge.
    for (let row = 0; row < maze.height; row++) {
      for (let col = 0; col < maze.width; col++) {
        if (!maze.isTunnelExit(col, row)) continue;
        const partner = maze.tunnelPartner(col, row);
        expect(partner).not.toBeNull();
        expect(partner.row).toBe(row); // horizontal wrap stays on the same row
        expect(partner.col).not.toBe(col);
        // symmetric pairing
        expect(maze.tunnelPartner(partner.col, partner.row)).toEqual({ col, row });
      }
    }
  });

  it('collectible count equals pellets + power pellets from the layout (Req 6.1)', () => {
    maze = makeMaze();
    const { pellets, powerPellets } = tally();
    expect(maze.remainingCollectibles()).toBe(pellets + powerPellets);
    expect(maze.remainingCollectibles()).toBeGreaterThan(0);
  });

  it('reset() restores the full collectible set after clearing the board (Req 6.4)', () => {
    maze = makeMaze();
    const original = maze.remainingCollectibles();

    // Walk every tile and consume whatever collectible is present.
    for (let row = 0; row < maze.height; row++) {
      for (let col = 0; col < maze.width; col++) {
        maze.removePellet(col, row);
        maze.removePowerPellet(col, row);
      }
    }
    expect(maze.remainingCollectibles()).toBe(0);

    maze.reset();
    expect(maze.remainingCollectibles()).toBe(original);
  });
});
