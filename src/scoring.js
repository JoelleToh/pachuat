// src/scoring.js
//
// Scoring utilities for the PacHuat simulation. Pure and DOM-free so the
// simulation layer and property-based tests can import it directly.
//
// Covers task 5.1: the POINTS table (pellet 10, power pellet 50, enemy 200)
// and clampScore(n), which floors to an integer and clamps the result to the
// inclusive range [0, SCORE_MAX] (0..9,999,999).
//
// Values are sourced from CONFIG in constants.js so there is a single source
// of truth and the point values / score ceiling cannot drift from the spec.
//
// Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 4.5

import { CONFIG } from './constants.js';

/**
 * Point values awarded for each scoring event.
 *   PELLET       = 10  (Req 2.1)
 *   POWER_PELLET = 50  (Req 2.2)
 *   ENEMY        = 200 (Req 2.3, 4.5)
 *
 * Re-exported from CONFIG.POINTS so the point table has a single definition.
 * @type {Readonly<{ PELLET: number, POWER_PELLET: number, ENEMY: number }>}
 */
export const POINTS = CONFIG.POINTS;

/**
 * Clamps a score to the valid display range as an integer.
 *
 * The result is floored to a whole number and bounded to the inclusive range
 * [0, CONFIG.SCORE_MAX] (0..9,999,999), so a negative input yields 0, an
 * input above the ceiling yields SCORE_MAX, and a non-finite input (NaN,
 * Infinity, non-numeric) yields 0 (Req 2.5, 2.6).
 *
 * @param {number} n - A raw score value, possibly fractional or out of range.
 * @returns {number} An integer in [0, 9_999_999].
 */
export function clampScore(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  const floored = Math.floor(value);
  if (floored < 0) return 0;
  if (floored > CONFIG.SCORE_MAX) return CONFIG.SCORE_MAX;
  return floored;
}
