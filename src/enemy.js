// src/enemy.js
//
// The Hamster enemy entity for PacHuat (task 7.1). Movement mirrors the
// tile-based, pixel-interpolated model of the Player (see src/player.js): a
// hamster always has a logical `tile` plus a sub-tile `progress` in [0, 1)
// describing how far it has advanced toward the next tile along its current
// direction. Direction decisions are made only at tile centers (progress == 0),
// which keeps motion grid-aligned while rendering at smoothly interpolated
// pixel positions.
//
// Behavior (design.md "enemy.js" interface + EnemyState data model):
//   - Constructed with a constant speed in [4,8] tiles/sec that never changes
//     for the life of the game (Req 3.2).
//   - In `chase` mode, pursue the player: at each tile center choose the open
//     direction whose neighbor has the shortest BFS distance to the player,
//     breaking ties up/left/down/right and reversing only when reversal is the
//     sole open option (Req 3.2, 3.3, 3.4, 3.7, 3.8). The `frightened` flag
//     passed into update toggles between chase and a frightened wander that
//     reuses the same selection machinery (direction is still deterministic).
//   - In `returning` mode (set by sendToSpawn after the player consumes the
//     hamster during Frightened state) the hamster relocates toward its spawn
//     using the same shortest-path selection, and flips back to `chase` once it
//     arrives (Req 4.4, 4.8).
//   - Wrap through horizontal tunnels, preserving direction and speed (Req 1.5
//     applied to enemies, as called out by design Property 3).
//
// `update(stepMs, maze, playerTile, frightened)` is deterministic (no clocks,
// no randomness): identical inputs always produce identical state, so it can be
// exercised directly by property test 4.2 (direction selection).
//
// Requirements: 3.2, 3.3, 3.4, 3.7, 3.8, 4.4, 4.8

import { VECTORS, sameTile } from './constants.js';
import { bfsDistances, chooseDirection } from './pathfinding.js';

/**
 * Enemy movement modes (design "EnemyState" data model).
 * @typedef {'chase'|'frightened'|'returning'} EnemyMode
 */

/**
 * Lower/upper bounds for the per-game constant enemy speed (Req 3.2).
 */
const MIN_SPEED_TPS = 4;
const MAX_SPEED_TPS = 8;

/**
 * Clamps a requested speed into the valid [4, 8] tiles/sec range (Req 3.2).
 * @param {number} speedTilesPerSec
 * @returns {number}
 */
function clampSpeed(speedTilesPerSec) {
  if (!Number.isFinite(speedTilesPerSec)) return MIN_SPEED_TPS;
  return Math.min(MAX_SPEED_TPS, Math.max(MIN_SPEED_TPS, speedTilesPerSec));
}

/**
 * Returns the neighbouring tile reached by moving one step in `dir` from
 * `tile`, or `null` when `dir` is null/unknown.
 * @param {{col:number,row:number}} tile
 * @param {('up'|'down'|'left'|'right'|null)} dir
 * @returns {{col:number,row:number}|null}
 */
function neighborTile(tile, dir) {
  const v = VECTORS[dir];
  if (!v) return null;
  return { col: tile.col + v.dcol, row: tile.row + v.drow };
}

/**
 * Whether moving in `dir` from `tile` leads onto an open (non-wall) path.
 * A null/unknown direction is never open.
 * @param {import('./maze.js').Maze} maze
 * @param {{col:number,row:number}} tile
 * @param {('up'|'down'|'left'|'right'|null)} dir
 * @returns {boolean}
 */
function dirIsOpen(maze, tile, dir) {
  const next = neighborTile(tile, dir);
  if (!next) return false;
  return !maze.isWall(next.col, next.row);
}

/**
 * A hamster enemy. Tile-based movement with pixel interpolation, a per-game
 * constant speed, and a BFS-driven pursuit that honours the fixed direction
 * selection rules.
 */
export class HamsterEnemy {
  /**
   * @param {{col:number,row:number}} spawn The hamster's spawn tile.
   * @param {number} speedTilesPerSec Constant speed in [4,8] for the whole
   *   game (Req 3.2). Values outside the range are clamped.
   */
  constructor(spawn, speedTilesPerSec) {
    /**
     * The per-game constant tile-crossing speed in tiles/second (Req 3.2).
     * Set once at construction and never mutated afterwards.
     * @type {number}
     */
    this.speedTilesPerSec = clampSpeed(speedTilesPerSec);

    /**
     * Tiles advanced per millisecond, derived from the constant speed.
     * @type {number}
     */
    this._tilesPerMs = this.speedTilesPerSec / 1000;

    this.resetTo(spawn);
  }

  /**
   * Repositions the hamster to a spawn tile and clears movement state
   * (direction, sub-tile progress), returning it to `chase` mode. The constant
   * speed is preserved (Req 3.2). Used on construction, after a life-losing
   * collision, and on restart (Req 5.4, 6.4).
   * @param {{col:number,row:number}} spawn
   * @returns {void}
   */
  resetTo(spawn) {
    /**
     * Remembered spawn tile (a copy, so external mutation cannot leak in).
     * @type {{col:number,row:number}}
     */
    this.spawn = { col: spawn.col, row: spawn.row };

    /**
     * Current logical tile.
     * @type {{col:number,row:number}}
     */
    this.tile = { col: spawn.col, row: spawn.row };

    /**
     * Current movement direction, or null when stationary.
     * @type {('up'|'down'|'left'|'right'|null)}
     */
    this.dir = null;

    /**
     * Current behavior mode.
     * @type {EnemyMode}
     */
    this.mode = 'chase';

    /**
     * Sub-tile progress toward the next tile along `dir`, in [0, 1). Zero means
     * the hamster is centered on `tile` (a decision point).
     * @type {number}
     */
    this.progress = 0;

    /**
     * Interpolated render position in tile units (col/row space). Pixel scaling
     * is applied by the renderer; keeping this in tile units keeps the enemy
     * DOM-free and resolution-independent.
     * @type {{x:number,y:number}}
     */
    this.pixel = { x: spawn.col, y: spawn.row };
  }

  /**
   * Begins relocating the hamster to its spawn after being consumed during
   * Frightened state (Req 4.4). The hamster enters `returning` mode and heads
   * for its spawn tile; it keeps moving (via update) until it arrives, at which
   * point it flips back to `chase` (Req 4.8). Calling this while already at the
   * spawn tile relocates immediately.
   * @returns {void}
   */
  sendToSpawn() {
    this.mode = 'returning';
    // If already standing on the spawn, finish instantly so a consumed hamster
    // that happens to be caught on its spawn tile doesn't linger (Req 4.4).
    if (sameTile(this.tile, this.spawn) && this.progress === 0) {
      this.mode = 'chase';
    }
  }

  /**
   * Advances the hamster by one fixed simulation step.
   *
   * Motion is continuous along `dir` at the constant per-game speed. Direction
   * decisions happen only when centered on a tile (progress == 0):
   *
   *   1. Resolve the current mode. The `frightened` flag selects between
   *      `chase` and `frightened` for a non-returning hamster; a `returning`
   *      hamster ignores the flag until it reaches its spawn (Req 4.8).
   *   2. Pick the pursuit target tile for the active mode:
   *      - chase: the player's current tile (pursue, Req 3.2).
   *      - returning: the hamster's spawn tile (relocate, Req 4.4/4.8).
   *      - frightened: the hamster's spawn tile is NOT used; instead it flees
   *        toward the farthest reachable tile so it moves away from the player.
   *   3. Choose a direction via BFS + the fixed selection rules (Req 3.3, 3.4,
   *      3.7, 3.8) using pathfinding.chooseDirection.
   *   4. Advance `progress`; on each whole-tile crossing step onto the next
   *      tile (wrapping through tunnels, Req 1.5) and re-decide at the new
   *      center. A returning hamster that reaches its spawn flips to `chase`
   *      (Req 4.8).
   *
   * @param {number} stepMs Fixed timestep in milliseconds (e.g. 1000 / SIM_HZ).
   * @param {import('./maze.js').Maze} maze The maze providing wall/tunnel data.
   * @param {{col:number,row:number}} playerTile The player's current tile.
   * @param {boolean} frightened Whether the game is in Frightened state.
   * @returns {void}
   */
  update(stepMs, maze, playerTile, frightened) {
    // Keep mode in sync with the frightened flag for non-returning hamsters.
    // A returning hamster finishes relocating before re-entering pursuit
    // (Req 4.8), so the flag does not override `returning`.
    if (this.mode !== 'returning') {
      this.mode = frightened ? 'frightened' : 'chase';
    }

    if (stepMs <= 0) {
      this._syncPixel();
      return;
    }

    // Remaining distance to travel this step, measured in tiles.
    let remaining = this._tilesPerMs * stepMs;

    // Decide the direction before moving if we are centered on a tile.
    if (this.progress === 0) {
      this._decideDirection(maze, playerTile);
    }

    while (remaining > 0) {
      // Blocked (dead end or walled-in): hold position for this step.
      if (this.dir == null || !dirIsOpen(maze, this.tile, this.dir)) {
        this._decideDirection(maze, playerTile);
        if (this.dir == null || !dirIsOpen(maze, this.tile, this.dir)) break;
      }

      const distToNextTile = 1 - this.progress;
      if (remaining < distToNextTile) {
        // Finish the step partway between tiles.
        this.progress += remaining;
        remaining = 0;
        break;
      }

      // Reach the next tile center exactly; carry the remainder forward.
      remaining -= distToNextTile;
      this._stepToNextTile(maze);
      this.progress = 0;

      // A returning hamster that has reached its spawn resumes pursuit
      // (Req 4.8). Do this before re-deciding so the new target is correct.
      if (this.mode === 'returning' && sameTile(this.tile, this.spawn)) {
        this.mode = frightened ? 'frightened' : 'chase';
      }

      this._decideDirection(maze, playerTile);
    }

    this._syncPixel();
  }

  /**
   * Chooses the movement direction while centered on the current tile, using
   * BFS shortest-path distances to the active mode's target tile and the fixed
   * selection rules (shortest distance, up/left/down/right tie-break, reverse
   * only as a last resort) (Req 3.2, 3.3, 3.4, 3.7, 3.8).
   *
   * Targets by mode:
   *   - chase: pursue the player's tile.
   *   - returning: head to the spawn tile (Req 4.4, 4.8).
   *   - frightened: flee toward the reachable tile farthest from the player so
   *     the hamster moves away; this reuses the same deterministic machinery.
   *
   * @param {import('./maze.js').Maze} maze
   * @param {{col:number,row:number}} playerTile
   * @returns {void}
   */
  _decideDirection(maze, playerTile) {
    let distances;

    if (this.mode === 'returning') {
      // Relocate toward spawn: distances measured from the spawn tile, so the
      // chosen neighbor minimizes distance to spawn (Req 4.4, 4.8).
      distances = bfsDistances(maze, this.spawn.col, this.spawn.row);
    } else if (this.mode === 'frightened' && playerTile) {
      // Flee: distances from the player, negated so chooseDirection's
      // minimum-distance pick becomes the maximum-distance (farthest) choice.
      // This keeps direction selection deterministic while moving away from
      // the player.
      const fromPlayer = bfsDistances(maze, playerTile.col, playerTile.row);
      distances = new Map();
      for (const [key, dist] of fromPlayer) {
        distances.set(key, -dist);
      }
    } else if (playerTile) {
      // chase (default): pursue the player (Req 3.2, 3.3).
      distances = bfsDistances(maze, playerTile.col, playerTile.row);
    } else {
      distances = new Map();
    }

    this.dir = chooseDirection(maze, this.tile, distances, this.dir);
  }

  /**
   * Steps the logical tile one cell along the current direction, wrapping
   * through a horizontal tunnel when the destination is a tunnel exit so the
   * hamster reappears at the partner edge with direction and speed preserved
   * (Req 1.5).
   * @param {import('./maze.js').Maze} maze
   * @returns {void}
   */
  _stepToNextTile(maze) {
    const next = neighborTile(this.tile, this.dir);
    if (!next) return;

    if (maze.isTunnelExit(next.col, next.row)) {
      const partner = maze.tunnelPartner(next.col, next.row);
      if (partner) {
        this.tile = { col: partner.col, row: partner.row };
        return;
      }
    }

    this.tile = next;
  }

  /**
   * Recomputes the interpolated render position (in tile units) from the
   * logical tile and sub-tile progress along the current direction.
   * @returns {void}
   */
  _syncPixel() {
    const v = this.dir != null ? VECTORS[this.dir] : null;
    const dx = v ? v.dcol * this.progress : 0;
    const dy = v ? v.drow * this.progress : 0;
    this.pixel = { x: this.tile.col + dx, y: this.tile.row + dy };
  }
}
