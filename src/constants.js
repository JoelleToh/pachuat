// src/constants.js
//
// Shared constants and data-model primitives used across the PacHuat
// simulation and I/O modules. This module is DOM-free so it can be imported
// by both the pure simulation layer and the renderer/layout layers.
//
// Covers tasks 2.1: direction vectors, fixed tie-break order, the full CONFIG
// object (exact values from design.md's Configuration Constants section), and
// direction/tile helpers (tileKey, opposite-direction lookup, etc.).

/**
 * The four cardinal directions. `null` represents "no movement".
 * @typedef {'up'|'down'|'left'|'right'} Direction
 */

/**
 * Direction unit vectors in grid (column/row) space.
 * Row increases downward, matching the maze layout rows.
 * @type {Readonly<Record<Direction, { dcol: number, drow: number }>>}
 */
export const VECTORS = Object.freeze({
  up: Object.freeze({ dcol: 0, drow: -1 }),
  down: Object.freeze({ dcol: 0, drow: 1 }),
  left: Object.freeze({ dcol: -1, drow: 0 }),
  right: Object.freeze({ dcol: 1, drow: 0 }),
});

/**
 * Fixed tie-break priority for enemy direction selection (Req 3.4).
 * When multiple candidate neighbors share the minimum distance, the earliest
 * direction in this list wins.
 * @type {ReadonlyArray<Direction>}
 */
export const TIE_BREAK_ORDER = Object.freeze(['up', 'left', 'down', 'right']);

/**
 * Opposite-direction lookup, used to detect/avoid reversal (Req 3.7, 3.8).
 * @type {Readonly<Record<Direction, Direction>>}
 */
export const OPPOSITE = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
});

/**
 * All valid movement directions as an ordered, frozen list.
 * @type {ReadonlyArray<Direction>}
 */
export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

/**
 * The full configuration object. Values are taken verbatim from design.md's
 * "Configuration Constants" section and must not drift from the spec.
 */
export const CONFIG = Object.freeze({
  SIM_HZ: 60, // fixed timestep rate
  PLAYER_SPEED_TPS: 6, // tiles/sec (Req 1.3)
  ENEMY_SPEED_TPS: 6, // tiles/sec, in [4,8] (Req 3.2)
  FRIGHTENED_MS: 8000, // (Req 4.1)
  FRIGHTENED_BLINK_MS: 2000, // blink window (Req 4.3)
  BLINK_TOGGLES_PER_SEC: 4, // (Req 4.3)
  START_LIVES: 3, // (Req 5.1)
  COLLISION_DEBOUNCE_MS: 1500, // (Req 5.3)
  BUFFER_EXPIRE_MS: 1000, // (Req 1.7)
  SPRITE_TIMEOUT_MS: 5000, // (Req 9.3)
  DPAD_MIN_TOUCH_PX: 44, // min D-pad touch target size (Req 10.2)
  ORIENTATION_REFLOW_MS: 500, // max reflow time on orientation change (Req 10.5)
  RESPONSIVE_MAX_WIDTH_PX: 600, // responsive scaling breakpoint (Req 7.6, 10.1)
  POINTS: Object.freeze({ PELLET: 10, POWER_PELLET: 50, ENEMY: 200 }),
  SCORE_MAX: 9_999_999,
});

// --- Direction helpers -----------------------------------------------------

/**
 * Returns the direction opposite to the given one, or `null` for a null/unknown
 * direction.
 * @param {Direction|null} dir
 * @returns {Direction|null}
 */
export function opposite(dir) {
  return OPPOSITE[dir] ?? null;
}

/**
 * True when `a` and `b` are opposite directions. A null/unknown input is never
 * considered a reversal.
 * @param {Direction|null} a
 * @param {Direction|null} b
 * @returns {boolean}
 */
export function isOpposite(a, b) {
  return a != null && b != null && OPPOSITE[a] === b;
}

/**
 * Returns the unit vector for a direction, or `null` for a null/unknown input.
 * @param {Direction|null} dir
 * @returns {{ dcol: number, drow: number }|null}
 */
export function vectorFor(dir) {
  return VECTORS[dir] ?? null;
}

/**
 * Applies one step of `dir` to a tile, returning the neighboring tile.
 * For a null/unknown direction the same coordinates are returned.
 * @param {number} col
 * @param {number} row
 * @param {Direction|null} dir
 * @returns {{ col: number, row: number }}
 */
export function step(col, row, dir) {
  const v = VECTORS[dir];
  if (!v) return { col, row };
  return { col: col + v.dcol, row: row + v.drow };
}

// --- Tile helpers ----------------------------------------------------------

/**
 * Canonical string key for a tile, suitable for Map/Set membership
 * (e.g. BFS visited sets and distance maps).
 * @param {number} col
 * @param {number} row
 * @returns {string}
 */
export function tileKey(col, row) {
  return `${col},${row}`;
}

/**
 * Parses a tile key produced by {@link tileKey} back into coordinates.
 * @param {string} key
 * @returns {{ col: number, row: number }}
 */
export function parseTileKey(key) {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

/**
 * True when two tiles address the same cell.
 * @param {{ col: number, row: number }} a
 * @param {{ col: number, row: number }} b
 * @returns {boolean}
 */
export function sameTile(a, b) {
  return a != null && b != null && a.col === b.col && a.row === b.row;
}
