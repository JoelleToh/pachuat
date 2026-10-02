// test/layout.fit.property.test.js
//
// Property-based test for portrait fit with adequate touch targets (task 12.3).
//
// Exercises the pure, DOM-free Layout.computeFit over a large space of portrait
// viewport sizes (height >= width, width <= RESPONSIVE_MAX_WIDTH_PX) and maze
// dimensions. Verifies that whenever the layout reports it fits (fit.fits ===
// true):
//   - the canvas render width stays within the viewport width (no horizontal
//     overflow / page scroll), and
//   - the stacked canvas height + D-pad footprint + chrome budget stays within
//     the viewport height (no vertical overflow / page scroll), and
//   - each D-pad button touch target is at least DPAD_MIN_TOUCH_PX (44) CSS px
//     on a side.
//
// Validates: Requirements 10.1, 10.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Layout } from '../src/layout.js';
import { CONFIG } from '../src/constants.js';

const { RESPONSIVE_MAX_WIDTH_PX, DPAD_MIN_TOUCH_PX } = CONFIG;

// Float tolerance matching the epsilon the fit computation uses internally.
const EPS = 1e-6;

// Feature: pacman-hamster, Property 24: Responsive layout fits the viewport in portrait with adequate touch targets
describe('Property 24: Responsive layout fits the viewport in portrait with adequate touch targets', () => {
  it('fits the canvas and D-pad within the portrait viewport with >= 44px touch targets', () => {
    fc.assert(
      fc.property(
        // Portrait viewport: width at or below the responsive breakpoint.
        fc.integer({ min: 1, max: RESPONSIVE_MAX_WIDTH_PX }),
        // Extra height beyond the width, so the viewport is portrait
        // (height >= width). Covers tall viewports where the layout fits.
        fc.integer({ min: 0, max: 1600 }),
        // Maze dimensions (tile counts) -> aspect ratio width / height.
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 60 }),
        // Chrome budget (HUD/padding/gaps outside the canvas + D-pad).
        fc.integer({ min: 0, max: 120 }),
        (vw, extraHeight, mazeWidth, mazeHeight, chromePx) => {
          const vh = vw + extraHeight; // portrait: height >= width

          const fit = Layout.computeFit(vw, vh, {
            mazeWidth,
            mazeHeight,
            chromePx,
          });

          // The property is conditional on the layout reporting a successful
          // fit. When it does, nothing may overflow the viewport.
          if (fit.fits) {
            // Req 10.1: no horizontal overflow -> canvas within viewport width.
            expect(fit.canvasWidth).toBeLessThanOrEqual(vw + EPS);

            // Req 10.1: no vertical overflow -> stacked canvas + D-pad + chrome
            // within the viewport height, so the page need not scroll.
            expect(fit.canvasHeight + fit.dpadSize + chromePx).toBeLessThanOrEqual(
              vh + EPS,
            );

            // Req 10.2: each D-pad touch target is at least 44 CSS px per side.
            expect(fit.buttonSize).toBeGreaterThanOrEqual(DPAD_MIN_TOUCH_PX);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
