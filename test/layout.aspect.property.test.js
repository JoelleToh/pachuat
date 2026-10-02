// test/layout.aspect.property.test.js
//
// Property-based test for aspect-ratio-preserving canvas scaling (task 12.2).
//
// Exercises the pure, DOM-free Layout.computeFit over a large space of
// viewport sizes and maze aspect ratios. Verifies that:
//   - whenever a positive canvas is produced, its width:height ratio equals the
//     maze aspect ratio (within float tolerance), and
//   - below the responsive breakpoint (viewport width < RESPONSIVE_MAX_WIDTH_PX)
//     the canvas render width never exceeds the viewport width.
//
// Validates: Requirements 7.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Layout } from '../src/layout.js';
import { CONFIG } from '../src/constants.js';

const { RESPONSIVE_MAX_WIDTH_PX } = CONFIG;

// Feature: pacman-hamster, Property 22: Responsive canvas scaling preserves aspect ratio
describe('Property 22: Responsive canvas scaling preserves aspect ratio', () => {
  it('keeps canvas aspect ratio = maze aspect ratio and width <= viewport width below the breakpoint', () => {
    fc.assert(
      fc.property(
        // Viewport width: span well below and above the responsive breakpoint
        // so both scaling regimes are exercised.
        fc.integer({ min: 1, max: 2000 }),
        // Viewport height: cover tiny (height-constrained) up to tall viewports.
        fc.integer({ min: 1, max: 2000 }),
        // Maze dimensions (tile counts) -> aspect ratio width/height.
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 60 }),
        (vw, vh, mazeWidth, mazeHeight) => {
          const fit = Layout.computeFit(vw, vh, { mazeWidth, mazeHeight });

          const mazeAspect = mazeWidth / mazeHeight;

          // Only assert the ratio when a real (positive) canvas is produced.
          if (fit.canvasWidth > 0 && fit.canvasHeight > 0) {
            const canvasAspect = fit.canvasWidth / fit.canvasHeight;
            // Relative tolerance to absorb floating-point rounding across the
            // width-cap / height-clamp branches.
            expect(canvasAspect).toBeCloseTo(mazeAspect, 6);

            // Req 7.6: below the responsive breakpoint the canvas render width
            // must not exceed the viewport width.
            if (vw < RESPONSIVE_MAX_WIDTH_PX) {
              expect(fit.canvasWidth).toBeLessThanOrEqual(vw + 1e-6);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
