// src/player.js
//
// The Player entity for PacHuat (task 6.1). Movement is tile-based with
// pixel interpolation: the player always has a logical `tile`, and a sub-tile
// `progress` in [0, 1) describes how far it has advanced toward the next tile
// along its current direction. Turn/stop decisions are made only at tile
// centers (progress == 0), which keeps motion grid-aligned while rendering at
// smoothly interpolated pixel positions.
//
// Behavior (design.md "player.js" interface + PlayerState data model):
//   - Advance toward the requested direction when it points at an open path,
//     at a constant PLAYER_SPEED_TPS tiles/second (Req 1.3).
//   - When the requested direction points at a wall, stay at the current tile
//     and retain the prior movement direction (Req 1.4).
//   - Wrap through horizontal tunnels, preserving direction and speed: on
//     stepping onto a tunnel exit the player reappears at the partner edge
//     (Req 1.5).
//   - Buffer a newly requested direction that is not yet open and apply it at
//     the first subsequent tile where it is open, discarding the buffer after
//     BUFFER_EXPIRE_MS (1000 ms) (Req 1.7).
//
// The `update(stepMs, maze, intent)` method is deterministic (no clocks, no
// randomness): identical inputs always produce identical state, so it can be
// exercised directly by property tests 6.2-6.5.
//
// Requirements: 1.3, 1.4, 1.5, 1.7

import { CONFIG, VECTORS } from './constants.js';

const { PLAYER_SPEED_TPS, BUFFER_EXPIRE_MS } = CONFIG;

/**
 * The tile-crossing speed, expressed as tiles advanced per millisecond. The
 * player covers PLAYER_SPEED_TPS tiles every 1000 ms along an open path.
 * @type {number}
 */
const TILES_PER_MS = PLAYER_SPEED_TPS / 1000;

/**
 * Returns the neighbouring tile reached by moving one step in `dir` from
 * `(col, row)`, or `null` when `dir` is null/unknown.
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
 * The user-controlled avatar. Tile-based movement with pixel interpolation and
 * a one-second input buffer for turns requested slightly early.
 */
export class Player {
  /**
   * @param {{col:number,row:number}} spawn The player's spawn tile.
   */
  constructor(spawn) {
    this.resetTo(spawn);
  }

  /**
   * Repositions the player to a spawn tile and clears all movement state
   * (direction, requested/buffered turns, sub-tile progress). Used on
   * construction, after a life-losing collision, and on restart (Req 5.4, 6.4).
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
     * Direction most recently requested via input intent.
     * @type {('up'|'down'|'left'|'right'|null)}
     */
    this.requestedDir = null;

    /**
     * A pending turn to apply at the next tile where it becomes open, or null
     * when nothing is buffered (Req 1.7).
     * @type {('up'|'down'|'left'|'right'|null)}
     */
    this.bufferedDir = null;

    /**
     * Age of the buffered direction in milliseconds; the buffer expires once
     * it reaches BUFFER_EXPIRE_MS (Req 1.7).
     * @type {number}
     */
    this.bufferAgeMs = 0;

    /**
     * Sub-tile progress toward the next tile along `dir`, in [0, 1). Zero means
     * the player is centered on `tile` (a decision point).
     * @type {number}
     */
    this.progress = 0;

    /**
     * Interpolated render position in tile units (col/row space). Pixel scaling
     * is applied by the renderer; keeping this in tile units keeps the Player
     * DOM-free and resolution-independent.
     * @type {{x:number,y:number}}
     */
    this.pixel = { x: spawn.col, y: spawn.row };
  }

  /**
   * Advances the player by one fixed simulation step.
   *
   * The step applies the current input intent, then advances continuous motion
   * along the player's direction at a constant speed. Direction changes and
   * stops happen only when the player is centered on a tile (progress == 0),
   * which is where it is meaningful to re-pick a direction:
   *
   *   1. Record the latest `intent` as `requestedDir`.
   *   2. At a tile center, decide the direction for the upcoming segment:
   *      - If the requested direction is open, turn to it (clearing any buffer).
   *      - Else if a buffered direction is open, apply the buffer.
   *      - Else keep the current direction if it is still open.
   *      - Else stop (a wall blocks movement; the prior `dir` is retained for
   *        buffering purposes but no displacement occurs) (Req 1.4).
   *      A requested direction that is not currently open is buffered so it can
   *      be applied at the first subsequent open tile (Req 1.7).
   *   3. Advance `progress` by speed * stepMs along the chosen direction at the
   *      constant PLAYER_SPEED_TPS (Req 1.3). Each time progress completes a
   *      whole tile, step onto the next tile, wrapping through a tunnel exit
   *      while preserving direction and speed (Req 1.5), then re-evaluate the
   *      direction at the new tile center so buffered/requested turns and walls
   *      take effect.
   *   4. Age the buffer and discard it once it exceeds BUFFER_EXPIRE_MS.
   *
   * @param {number} stepMs Fixed timestep in milliseconds (e.g. 1000 / SIM_HZ).
   * @param {import('./maze.js').Maze} maze The maze providing wall/tunnel data.
   * @param {('up'|'down'|'left'|'right'|null)} [intent] The current requested
   *   movement direction from input, or null for no change.
   * @returns {void}
   */
  update(stepMs, maze, intent) {
    if (stepMs <= 0) {
      this._syncPixel();
      return;
    }

    if (intent != null) {
      this.requestedDir = intent;
      // A freshly requested direction (re)starts the buffer window. If the
      // turn can be taken immediately it is cleared again below; otherwise it
      // persists so the turn applies at the next open tile (Req 1.7).
      this.bufferedDir = intent;
      this.bufferAgeMs = 0;
    }

    // Remaining distance to travel this step, measured in tiles.
    let remaining = TILES_PER_MS * stepMs;

    // If we are centered on a tile, choose the direction before moving.
    if (this.progress === 0) {
      this._chooseDirectionAtTile(maze);
    }

    // Advance across (possibly multiple) tiles within this step.
    while (remaining > 0) {
      // Blocked: no open direction to travel. Hold position (Req 1.4).
      if (this.dir == null || !dirIsOpen(maze, this.tile, this.dir)) {
        this.dir = this._openHeldDir(maze);
        if (this.dir == null) break;
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
      // Re-decide direction now that we are centered on a new tile so buffered
      // turns, requested turns, and walls take effect (Req 1.7, 1.4).
      this._chooseDirectionAtTile(maze);
    }

    this._ageBuffer(stepMs);
    this._syncPixel();
  }

  /**
   * Chooses the movement direction while centered on the current tile.
   * Priority: an open requested turn, then an open buffered turn, then keeping
   * the current direction if still open, otherwise stop. A requested direction
   * that is blocked is buffered for a later open tile (Req 1.4, 1.7).
   * @param {import('./maze.js').Maze} maze
   * @returns {void}
   */
  _chooseDirectionAtTile(maze) {
    // Prefer the most recent request when it is immediately possible.
    if (this.requestedDir != null && dirIsOpen(maze, this.tile, this.requestedDir)) {
      this.dir = this.requestedDir;
      this.bufferedDir = null;
      this.bufferAgeMs = 0;
      return;
    }

    // Otherwise apply a buffered turn as soon as it opens up (Req 1.7).
    if (this.bufferedDir != null && dirIsOpen(maze, this.tile, this.bufferedDir)) {
      this.dir = this.bufferedDir;
      this.bufferedDir = null;
      this.bufferAgeMs = 0;
      return;
    }

    // Keep moving in the current direction if the path ahead is still open.
    if (this.dir != null && dirIsOpen(maze, this.tile, this.dir)) {
      return;
    }

    // A wall blocks all available turns: stop but retain the prior direction so
    // nothing visually "unturns" and so a buffered request can still apply at a
    // later tile (Req 1.4).
    this.dir = null;
  }

  /**
   * Returns the current direction if it is still open, otherwise null. Used
   * mid-step to confirm the player can keep travelling.
   * @param {import('./maze.js').Maze} maze
   * @returns {('up'|'down'|'left'|'right'|null)}
   */
  _openHeldDir(maze) {
    if (this.dir != null && dirIsOpen(maze, this.tile, this.dir)) return this.dir;
    return null;
  }

  /**
   * Steps the logical tile one cell along the current direction, wrapping
   * through a horizontal tunnel when the destination is a tunnel exit so the
   * player reappears at the partner edge with direction and speed preserved
   * (Req 1.5).
   * @param {import('./maze.js').Maze} maze
   * @returns {void}
   */
  _stepToNextTile(maze) {
    const next = neighborTile(this.tile, this.dir);
    if (!next) return;

    // Tunnel wrap: stepping onto a tunnel exit tile relocates the player to the
    // partner edge tile, keeping dir and progress (speed) untouched (Req 1.5).
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
   * Ages the input buffer by one step and discards it once it has lived longer
   * than BUFFER_EXPIRE_MS without being applied (Req 1.7).
   * @param {number} stepMs
   * @returns {void}
   */
  _ageBuffer(stepMs) {
    if (this.bufferedDir == null) {
      this.bufferAgeMs = 0;
      return;
    }
    this.bufferAgeMs += stepMs;
    if (this.bufferAgeMs >= BUFFER_EXPIRE_MS) {
      this.bufferedDir = null;
      this.bufferAgeMs = 0;
    }
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
