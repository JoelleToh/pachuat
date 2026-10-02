// src/maze.js
//
// The Maze grid model for PacHuat (task 3.1). A Maze is parsed from a
// human-editable array of equal-length strings (one character per tile) into
// an immutable structural grid (walls, tunnels, spawn locations) plus a
// mutable pellet/power-pellet state that can be consumed and reset.
//
// Layout character legend (design.md "Maze Layout"):
//   #        wall
//   (space)  empty path
//   .        pellet
//   o        power pellet
//   P        player spawn (an open path tile)
//   H        hamster spawn (an open path tile)
//   T        tunnel edge marker (horizontal wrap; an open path tile)
//
// Requirements covered: 1.1 (render maze/spawns), 1.5 (horizontal tunnel
// wrap), 2.1/2.2 (pellet & power-pellet point values), 2.7 (idempotent empty
// consumption), 6.1 (remaining collectible count), 6.4 (reset restores the
// full pellet set).

import { VECTORS, tileKey, CONFIG } from './constants.js';

// Point values sourced from the shared config (Pellet = 10, PowerPellet = 50).
const POINTS = CONFIG.POINTS;

/**
 * Character set used by the layout parser.
 */
const CHAR = Object.freeze({
  WALL: '#',
  PATH: ' ',
  PELLET: '.',
  POWER_PELLET: 'o',
  PLAYER_SPAWN: 'P',
  HAMSTER_SPAWN: 'H',
  TUNNEL: 'T',
});

/**
 * The concrete default maze layout.
 *
 * - All rows are the same length (required for a rectangular grid).
 * - Exactly one player spawn `P` and four hamster spawns `H`.
 * - Horizontal tunnels: `T` markers sit on the left and right edges of two
 *   rows; each left `T` pairs with the right `T` on the same row so a
 *   character leaving one edge reappears at the opposite edge (Req 1.5).
 *
 * @type {ReadonlyArray<string>}
 */
export const DEFAULT_MAZE_LAYOUT = Object.freeze([
  '####################',
  '#........##........#',
  '#o##.###.##.###.##o#',
  '#..................#',
  '#.##.#.######.#.##.#',
  '#....#...##...#....#',
  '####.###.##.###.####',
  '####.#........#.####',
  '####.#.##HH##.#.####',
  'T......#H  H#......T',
  '####.#.######.#.####',
  '####.#........#.####',
  '####.#.######.#.####',
  '#........##........#',
  '#.##.###.##.###.##.#',
  '#o.#.....P......#.o#',
  '##.#.#.######.#.#.##',
  '#....#...##...#....#',
  '#.######.##.######.#',
  '#..................#',
  '####################',
]);

/**
 * @typedef {Object} MazeCell
 * @property {boolean} wall
 * @property {boolean} pellet       current (mutable) pellet presence
 * @property {boolean} powerPellet  current (mutable) power-pellet presence
 * @property {boolean} tunnel
 */

/**
 * Grid-based maze model. Structure (walls/tunnels/spawns) is fixed at
 * construction; pellet state is mutable and restorable via {@link Maze#reset}.
 */
export class Maze {
  /**
   * @param {ReadonlyArray<string>} [layout] Array of equal-length strings.
   *   Defaults to {@link DEFAULT_MAZE_LAYOUT}.
   */
  constructor(layout = DEFAULT_MAZE_LAYOUT) {
    if (!Array.isArray(layout) || layout.length === 0) {
      throw new Error('Maze layout must be a non-empty array of strings.');
    }

    this._height = layout.length;
    this._width = layout[0].length;

    for (const row of layout) {
      if (typeof row !== 'string' || row.length !== this._width) {
        throw new Error('Maze layout rows must be equal-length strings.');
      }
    }

    /** @type {boolean[][]} */
    this._walls = [];
    /** @type {boolean[][]} */
    this._tunnels = [];
    // Immutable record of the original pellet/power-pellet placement, used to
    // restore state on reset().
    /** @type {boolean[][]} */
    this._initialPellets = [];
    /** @type {boolean[][]} */
    this._initialPowerPellets = [];
    // Mutable, consumable pellet state.
    /** @type {boolean[][]} */
    this._pellets = [];
    /** @type {boolean[][]} */
    this._powerPellets = [];

    /** @type {{col:number,row:number}|null} */
    this._playerSpawn = null;
    /** @type {{col:number,row:number}[]} */
    this._hamsterSpawns = [];

    // Tunnel edge tiles collected during parsing, paired afterward by row.
    /** @type {{col:number,row:number}[]} */
    const tunnelTiles = [];

    for (let row = 0; row < this._height; row++) {
      this._walls[row] = [];
      this._tunnels[row] = [];
      this._initialPellets[row] = [];
      this._initialPowerPellets[row] = [];
      this._pellets[row] = [];
      this._powerPellets[row] = [];

      const line = layout[row];
      for (let col = 0; col < this._width; col++) {
        const ch = line[col];
        let wall = false;
        let tunnel = false;
        let pellet = false;
        let powerPellet = false;

        switch (ch) {
          case CHAR.WALL:
            wall = true;
            break;
          case CHAR.PATH:
            break;
          case CHAR.PELLET:
            pellet = true;
            break;
          case CHAR.POWER_PELLET:
            powerPellet = true;
            break;
          case CHAR.PLAYER_SPAWN:
            if (this._playerSpawn !== null) {
              throw new Error('Maze layout must contain exactly one player spawn (P).');
            }
            this._playerSpawn = { col, row };
            break;
          case CHAR.HAMSTER_SPAWN:
            this._hamsterSpawns.push({ col, row });
            break;
          case CHAR.TUNNEL:
            tunnel = true;
            tunnelTiles.push({ col, row });
            break;
          default:
            throw new Error(`Unknown maze layout character '${ch}' at (${col},${row}).`);
        }

        this._walls[row][col] = wall;
        this._tunnels[row][col] = tunnel;
        this._initialPellets[row][col] = pellet;
        this._initialPowerPellets[row][col] = powerPellet;
        this._pellets[row][col] = pellet;
        this._powerPellets[row][col] = powerPellet;
      }
    }

    // Pair tunnel edges by row: the left-most and right-most T on a shared row
    // become each other's partner. Keyed by tileKey for O(1) lookup.
    /** @type {Map<string, {col:number,row:number}>} */
    this._tunnelPartners = new Map();
    const byRow = new Map();
    for (const t of tunnelTiles) {
      if (!byRow.has(t.row)) byRow.set(t.row, []);
      byRow.get(t.row).push(t);
    }
    for (const [, tiles] of byRow) {
      if (tiles.length !== 2) {
        throw new Error(
          `Each tunnel row must have exactly two tunnel edges (T); row has ${tiles.length}.`
        );
      }
      const [a, b] = tiles.sort((x, y) => x.col - y.col);
      this._tunnelPartners.set(tileKey(a.col, a.row), { col: b.col, row: b.row });
      this._tunnelPartners.set(tileKey(b.col, b.row), { col: a.col, row: a.row });
    }
  }

  /** @returns {number} Number of columns. */
  get width() {
    return this._width;
  }

  /** @returns {number} Number of rows. */
  get height() {
    return this._height;
  }

  /**
   * Player spawn tile (a copy, so callers cannot mutate internal state).
   * @returns {{col:number,row:number}|null}
   */
  get playerSpawn() {
    return this._playerSpawn ? { ...this._playerSpawn } : null;
  }

  /**
   * The four hamster spawn tiles (copies).
   * @returns {{col:number,row:number}[]}
   */
  get hamsterSpawns() {
    return this._hamsterSpawns.map((s) => ({ ...s }));
  }

  /**
   * True when the coordinate is outside the grid bounds.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  _outOfBounds(col, row) {
    return col < 0 || row < 0 || col >= this._width || row >= this._height;
  }

  /**
   * Whether the given tile is a wall. Out-of-bounds tiles are treated as walls.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  isWall(col, row) {
    if (this._outOfBounds(col, row)) return true;
    return this._walls[row][col];
  }

  /**
   * Whether the given tile is a horizontal tunnel exit edge (Req 1.5).
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  isTunnelExit(col, row) {
    if (this._outOfBounds(col, row)) return false;
    return this._tunnels[row][col];
  }

  /**
   * The partner tile on the opposite edge for a tunnel exit, or `null` when the
   * tile is not a tunnel exit.
   * @param {number} col
   * @param {number} row
   * @returns {{col:number,row:number}|null}
   */
  tunnelPartner(col, row) {
    const partner = this._tunnelPartners.get(tileKey(col, row));
    return partner ? { ...partner } : null;
  }

  /**
   * Whether the given tile currently holds an uneaten pellet.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  hasPellet(col, row) {
    if (this._outOfBounds(col, row)) return false;
    return this._pellets[row][col];
  }

  /**
   * Whether the given tile currently holds an uneaten power pellet.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  hasPowerPellet(col, row) {
    if (this._outOfBounds(col, row)) return false;
    return this._powerPellets[row][col];
  }

  /**
   * Open (walkable, in-bounds) neighbors of a tile.
   * @param {number} col
   * @param {number} row
   * @returns {{col:number,row:number}[]}
   */
  openNeighbors(col, row) {
    const result = [];
    for (const dir of Object.keys(VECTORS)) {
      const { dcol, drow } = VECTORS[dir];
      const ncol = col + dcol;
      const nrow = row + drow;
      if (!this.isWall(ncol, nrow)) {
        result.push({ col: ncol, row: nrow });
      }
    }
    return result;
  }

  /**
   * Removes a pellet from the given tile if present.
   * @param {number} col
   * @param {number} row
   * @returns {number} The points removed (10 for a pellet), or 0 if the tile
   *   had no pellet (idempotent on an already-empty tile, Req 2.7).
   */
  removePellet(col, row) {
    if (!this.hasPellet(col, row)) return 0;
    this._pellets[row][col] = false;
    return POINTS.PELLET;
  }

  /**
   * Removes a power pellet from the given tile if present.
   * @param {number} col
   * @param {number} row
   * @returns {number} The points removed (50 for a power pellet), or 0 if the
   *   tile had no power pellet (idempotent, Req 2.7).
   */
  removePowerPellet(col, row) {
    if (!this.hasPowerPellet(col, row)) return 0;
    this._powerPellets[row][col] = false;
    return POINTS.POWER_PELLET;
  }

  /**
   * The combined count of remaining pellets and power pellets (Req 6.1).
   * Reaching 0 is the win condition.
   * @returns {number}
   */
  remainingCollectibles() {
    let count = 0;
    for (let row = 0; row < this._height; row++) {
      for (let col = 0; col < this._width; col++) {
        if (this._pellets[row][col] || this._powerPellets[row][col]) count++;
      }
    }
    return count;
  }

  /**
   * Restores the full set of pellets and power pellets to their original
   * placement (Req 6.4). Walls, tunnels, and spawns are unaffected.
   * @returns {void}
   */
  reset() {
    for (let row = 0; row < this._height; row++) {
      for (let col = 0; col < this._width; col++) {
        this._pellets[row][col] = this._initialPellets[row][col];
        this._powerPellets[row][col] = this._initialPowerPellets[row][col];
      }
    }
  }
}
