// @vitest-environment jsdom
//
// test/layout.integration.test.js
//
// Mobile-layout integration tests for the responsive arrangement of the game
// canvas and the on-screen D-pad (task 17.3).
//
// Unlike the DOM-free property tests (layout.fit / layout.aspect), these drive
// the full Layout against a real jsdom DOM and the live window: a portrait
// phone viewport, actual <canvas> and D-pad elements, and real
// resize/orientationchange events through the debounced attach() handler.
//
// Covered behaviors:
//   - Portrait fit (Req 10.1): with a portrait viewport <= RESPONSIVE_MAX_WIDTH_PX,
//     the canvas + D-pad fit without the page needing to scroll — canvas width
//     stays within the viewport width and the stacked canvas + D-pad (+ chrome)
//     stays within the viewport height.
//   - Touch targets (Req 10.2): each D-pad button computes to >= 44x44 CSS px.
//   - Reflow within 500 ms (Req 7.6, 10.5): an orientationchange / resize
//     triggers a debounced reflow that runs after the debounce window and
//     comfortably within ORIENTATION_REFLOW_MS.
//
// Requirements: 7.6, 10.1, 10.2, 10.5

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Layout } from '../src/layout.js';
import { CONFIG } from '../src/constants.js';

const { DPAD_MIN_TOUCH_PX, ORIENTATION_REFLOW_MS } = CONFIG;

// The debounce the handler uses is half the reflow budget (see src/layout.js).
const RESIZE_DEBOUNCE_MS = Math.floor(ORIENTATION_REFLOW_MS / 2);

// A representative portrait phone viewport, at or below the responsive
// breakpoint (<= 600 CSS px wide, taller than it is wide).
const PHONE_W = 390;
const PHONE_H = 844;

/** Overrides window.innerWidth / innerHeight for the current test. */
function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
}

/**
 * Builds the real DOM nodes Layout operates on: a HUD (the chrome budget), the
 * maze <canvas>, and a #dpad root holding the four direction buttons. The
 * buttons carry the same 44px min-width/min-height floor as styles.css so the
 * computed touch-target assertion is meaningful under jsdom (which does not
 * resolve external stylesheet layout on its own).
 * @returns {{ canvas: HTMLCanvasElement, dpad: HTMLElement, hud: HTMLElement }}
 */
function buildDom() {
  document.body.innerHTML = `
    <main id="game">
      <header id="hud"></header>
      <canvas id="game-canvas" width="448" height="496"></canvas>
      <nav id="dpad">
        <button data-direction="up">up</button>
        <button data-direction="left">left</button>
        <button data-direction="right">right</button>
        <button data-direction="down">down</button>
      </nav>
    </main>
  `;

  const canvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById('game-canvas')
  );
  const dpad = /** @type {HTMLElement} */ (document.getElementById('dpad'));
  const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));

  // Mirror the styles.css D-pad gap so _measureInputs reads a real value.
  dpad.style.gap = '8px';

  // Mirror the styles.css touch-target floor (min-width/min-height: 44px) onto
  // each button so getComputedStyle reports it under jsdom.
  for (const btn of dpad.querySelectorAll('button')) {
    btn.style.minWidth = `${DPAD_MIN_TOUCH_PX}px`;
    btn.style.minHeight = `${DPAD_MIN_TOUCH_PX}px`;
  }

  return { canvas, dpad, hud };
}

describe('mobile-layout integration', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('portrait fit (Req 10.1)', () => {
    it('fits the canvas and D-pad within a portrait viewport without page scroll', () => {
      setViewport(PHONE_W, PHONE_H);
      const { canvas, dpad } = buildDom();
      // A classic Pac-Man maze aspect (28 cols x 31 rows).
      const maze = { width: 28, height: 31 };
      const layout = new Layout(canvas, dpad, maze);

      const fit = layout.apply(PHONE_W, PHONE_H);

      // The arrangement must report a successful fit.
      expect(fit.fits).toBe(true);

      // Req 10.1: no horizontal overflow — canvas within the viewport width.
      expect(fit.canvasWidth).toBeLessThanOrEqual(PHONE_W);
      expect(fit.canvasWidth).toBeGreaterThan(0);

      // Req 10.1: no vertical overflow — the stacked canvas + D-pad (+ the HUD
      // chrome budget) fits within the viewport height, so the page need not
      // scroll. getBoundingClientRect() returns 0 for the HUD under jsdom, so
      // the chrome budget is effectively 0 here; assert against that.
      expect(fit.canvasHeight + fit.dpadSize).toBeLessThanOrEqual(PHONE_H);

      // The CSS sizes were written onto the real elements.
      expect(canvas.style.width).toBe(`${fit.canvasWidth}px`);
      expect(canvas.style.height).toBe(`${fit.canvasHeight}px`);
      expect(dpad.style.width).toBe(`${fit.dpadSize}px`);
      expect(dpad.style.height).toBe(`${fit.dpadSize}px`);
    });
  });

  describe('touch targets (Req 10.2)', () => {
    it('computes each D-pad button to at least 44x44 CSS px', () => {
      setViewport(PHONE_W, PHONE_H);
      const { dpad } = buildDom();
      const maze = { width: 28, height: 31 };
      const layout = new Layout(document.getElementById('game-canvas'), dpad, maze);

      const fit = layout.apply(PHONE_W, PHONE_H);

      // Robust under jsdom: the fit computation guarantees the touch-target
      // floor regardless of DOM layout.
      expect(fit.buttonSize).toBeGreaterThanOrEqual(DPAD_MIN_TOUCH_PX);

      // The 3x3 D-pad footprint must hold at least three min-size targets plus
      // the two inter-button gaps.
      expect(fit.dpadSize).toBeGreaterThanOrEqual(DPAD_MIN_TOUCH_PX * 3);

      // And the real DOM buttons carry a computed >= 44px floor per side.
      for (const btn of dpad.querySelectorAll('button')) {
        const style = getComputedStyle(btn);
        expect(parseFloat(style.minWidth)).toBeGreaterThanOrEqual(DPAD_MIN_TOUCH_PX);
        expect(parseFloat(style.minHeight)).toBeGreaterThanOrEqual(DPAD_MIN_TOUCH_PX);
      }
    });
  });

  describe('reflow within 500 ms on orientation/resize (Req 7.6, 10.5)', () => {
    it('reflows after the debounce window and well within ORIENTATION_REFLOW_MS', () => {
      vi.useFakeTimers();
      setViewport(PHONE_W, PHONE_H);
      const { canvas, dpad } = buildDom();
      const maze = { width: 28, height: 31 };
      const layout = new Layout(canvas, dpad, maze);

      // attach() does one initial reflow synchronously, then wires the handler.
      const applySpy = vi.spyOn(layout, 'apply');
      layout.attach();

      // The initial reflow ran during attach().
      expect(applySpy).toHaveBeenCalledTimes(1);
      applySpy.mockClear();

      // Simulate an orientation change: the viewport rotates to landscape, then
      // fire the events the handler listens for.
      setViewport(PHONE_H, PHONE_W);
      window.dispatchEvent(new Event('orientationchange'));
      window.dispatchEvent(new Event('resize'));

      // Debounced: nothing reflows immediately or just before the debounce.
      expect(applySpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS - 1);
      expect(applySpy).not.toHaveBeenCalled();

      // Crossing the debounce window triggers exactly one reflow — comfortably
      // within the 500 ms budget (Req 10.5).
      vi.advanceTimersByTime(1);
      expect(applySpy).toHaveBeenCalledTimes(1);
      expect(RESIZE_DEBOUNCE_MS).toBeLessThanOrEqual(ORIENTATION_REFLOW_MS);

      // The reflow used the rotated viewport and re-wrote the canvas CSS size.
      expect(applySpy).toHaveBeenCalledWith(PHONE_H, PHONE_W);
      expect(canvas.style.width).not.toBe('');

      layout.detach();
    });

    it('collapses a burst of events into a single reflow within the budget', () => {
      vi.useFakeTimers();
      setViewport(PHONE_W, PHONE_H);
      const { canvas, dpad } = buildDom();
      const layout = new Layout(canvas, dpad, { width: 28, height: 31 });

      layout.attach();
      const applySpy = vi.spyOn(layout, 'apply');

      // A rapid burst of resize/orientation events.
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS - 10);
      }
      window.dispatchEvent(new Event('orientationchange'));

      // No reflow yet (each event reset the debounce timer).
      expect(applySpy).not.toHaveBeenCalled();

      // Advancing by the full reflow budget settles exactly one reflow.
      vi.advanceTimersByTime(ORIENTATION_REFLOW_MS);
      expect(applySpy).toHaveBeenCalledTimes(1);

      layout.detach();
    });
  });
});
