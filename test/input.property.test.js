// test/input.property.test.js
//
// Property-based test for D-pad input intent resolution (task 11.3).
//
// Covers design Property 4 "Most recent direction tap wins within a frame":
// for all non-empty sequences of D-pad direction taps received within a single
// frame, the resulting requested movement direction (InputHandler.intent)
// equals the direction of the final tap. Each setFromDpad call overwrites the
// stored intent, so the last-received direction wins (Req 1.6, 8.4).
//
// Validates: Requirements 1.6, 8.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { InputHandler } from '../src/input.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Feature: pacman-hamster, Property 4: Most recent direction tap wins within a frame
describe('Property 4: Most recent direction tap wins within a frame', () => {
  it('resolves intent to the direction of the final tap in a non-empty sequence', () => {
    fc.assert(
      fc.property(
        // A non-empty sequence of D-pad taps landing within one frame.
        fc.array(fc.constantFrom(...DIRECTIONS), { minLength: 1 }),
        (taps) => {
          const handler = new InputHandler();
          for (const direction of taps) {
            handler.setFromDpad(direction);
          }
          // The most recent tap wins: intent equals the last tapped direction.
          expect(handler.intent).toBe(taps[taps.length - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
