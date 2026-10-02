// test/scoring.property.test.js
//
// Property-based test for the scoring utilities (task 5.2).
//
// Covers design Property 8 "Score stays within bounds": for all arbitrary
// sequences of scoring events, the resulting score (via clampScore) is clamped
// to the inclusive integer range 0..9,999,999.
//
// Validates: Requirements 2.5, 2.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { clampScore, POINTS } from '../src/scoring.js';
import { CONFIG } from '../src/constants.js';

const SCORE_MAX = CONFIG.SCORE_MAX; // 9_999_999

// Feature: pacman-hamster, Property 8: Score stays within bounds
describe('Property 8: Score stays within bounds', () => {
  it('clamps any single arbitrary number to an integer in [0, SCORE_MAX]', () => {
    fc.assert(
      fc.property(
        // Cover negatives, large values, fractional, and extremes.
        fc.oneof(
          fc.integer(),
          fc.double({ noDefaultInfinity: true, noNaN: true }),
          fc.double(), // may include NaN / +-Infinity
          fc.constantFrom(
            0,
            -0,
            -1,
            SCORE_MAX,
            SCORE_MAX - 1,
            SCORE_MAX + 1,
            Number.MAX_SAFE_INTEGER,
            Number.MIN_SAFE_INTEGER,
            Number.MAX_VALUE,
            -Number.MAX_VALUE,
            Number.EPSILON,
            0.5,
            -0.5,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            NaN,
          ),
        ),
        (n) => {
          const result = clampScore(n);
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(SCORE_MAX);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps an accumulated sequence of point deltas within bounds after clamping', () => {
    // Model a game session as a sequence of scoring events. Each event awards
    // a realistic point value (pellet/power pellet/enemy) but we also allow
    // arbitrary deltas (including negatives and huge jumps) to stress the
    // clamp. The running score, clamped at each step, must always remain an
    // integer in [0, SCORE_MAX].
    const pointDelta = fc.oneof(
      fc.constantFrom(POINTS.PELLET, POINTS.POWER_PELLET, POINTS.ENEMY),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.integer(), // full 32-bit range, incl. extremes
      fc.double(), // fractional / NaN / Infinity
    );

    fc.assert(
      fc.property(fc.array(pointDelta, { maxLength: 200 }), (deltas) => {
        let score = 0;
        for (const delta of deltas) {
          // Accumulate then clamp, mirroring how the game guards the score.
          score = clampScore(score + delta);
          expect(Number.isInteger(score)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(SCORE_MAX);
        }
        // Final result is also within bounds.
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(SCORE_MAX);
      }),
      { numRuns: 100 },
    );
  });
});
