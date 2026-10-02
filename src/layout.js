// src/layout.js
//
// Layout: owns the mobile-first responsive arrangement of the game canvas and
// the on-screen D-pad (Req 7.6, 10.1, 10.2, 10.5).
//
// The sizing math is split into a pure, DOM-free computation
// (`Layout.computeFit`) and a thin DOM-applying wrapper (`apply`). The pure
// function takes the viewport dimensions plus the fixed layout inputs (maze
// aspect ratio and the chrome/gap budget) and returns the canvas render size,
// the D-pad footprint, and whether everything fits the viewport without the
// page needing to scroll. Keeping it pure lets the property tests (12.2 / 12.3)
// exercise the fit logic across a large input space with no DOM.
//
// `apply(viewportWidth, viewportHeight)` runs the pure computation and writes
// the resulting CSS pixel sizes onto the canvas and D-pad elements. attach()
// wires a debounced resize/orientationchange handler that reflows within
// ORIENTATION_REFLOW_MS (500 ms); detach() tears it down.
//
// Covers task 12.1.
//
// Requirements: 7.6, 10.1, 10.2, 10.5

import { CONFIG } from './constants.js';

const { DPAD_MIN_TOUCH_PX, ORIENTATION_REFLOW_MS, RESPONSIVE_MAX_WIDTH_PX } = CONFIG;

/**
 * Debounce delay for the resize/orientationchange handler. Kept well under
 * ORIENTATION_REFLOW_MS so a reflow completes within the 500 ms budget
 * (Req 10.5) even accounting for the trailing-edge debounce.
 * @type {number}
 */
const RESIZE_DEBOUNCE_MS = Math.floor(ORIENTATION_REFLOW_MS / 2);

/**
 * @typedef {Object} FitResult
 * @property {number} canvasWidth   Canvas render width in CSS pixels.
 * @property {number} canvasHeight  Canvas render height in CSS pixels.
 * @property {number} dpadSize      D-pad footprint (square) side in CSS pixels.
 * @property {number} buttonSize    Side of a single D-pad touch target in CSS px.
 * @property {boolean} fits         True when canvas + D-pad fit the viewport
 *                                  (in portrait, below the responsive breakpoint)
 *                                  without the page needing to scroll.
 */

export class Layout {
  /**
   * @param {HTMLCanvasElement} canvas  The maze canvas element.
   * @param {Element} dpadRoot          The D-pad root (its buttonsRoot).
   * @param {{ width: number, height: number }} maze  The maze grid; `width` and
   *   `height` are tile counts used only for their aspect ratio.
   */
  constructor(canvas, dpadRoot, maze) {
    /** @type {HTMLCanvasElement|null} */
    this.canvas = canvas ?? null;
    /** @type {Element|null} */
    this.dpadRoot = dpadRoot ?? null;
    /** @type {{ width: number, height: number }|null} */
    this.maze = maze ?? null;

    /** @type {ReturnType<typeof setTimeout>|null} */
    this._debounceTimer = null;
    /** @type {boolean} */
    this._attached = false;

    // Bound once so attach()/detach() add and remove the same listener.
    /** @type {() => void} */
    this._onResize = () => this._scheduleReflow();
  }

  /**
   * Pure fit computation (DOM-free). Given the viewport box and the fixed
   * layout inputs, returns the canvas render size, the D-pad footprint, and
   * whether the arrangement fits the viewport without scrolling.
   *
   * The canvas render width never exceeds the viewport width and its
   * width:height ratio always equals the maze aspect ratio (Req 7.6). The
   * D-pad is modeled as a 3x3 cross (matching styles.css): its side is three
   * button touch targets plus two inter-button gaps, with each button at least
   * DPAD_MIN_TOUCH_PX on a side (Req 10.2). When the stacked canvas + D-pad
   * (plus the vertical chrome budget) would exceed the viewport height, the
   * canvas is scaled down so both fit in portrait without page scroll
   * (Req 10.1); if even the minimum-size D-pad cannot coexist with any positive
   * canvas, `fits` is false.
   *
   * @param {number} viewportWidth   Available viewport width in CSS pixels.
   * @param {number} viewportHeight  Available viewport height in CSS pixels.
   * @param {Object} [options]
   * @param {number} [options.aspect]       Maze aspect ratio (width/height). Required
   *   unless `mazeWidth`/`mazeHeight` are given.
   * @param {number} [options.mazeWidth]    Maze column count (used to derive aspect).
   * @param {number} [options.mazeHeight]   Maze row count (used to derive aspect).
   * @param {number} [options.minButtonPx]  Minimum D-pad button side (default DPAD_MIN_TOUCH_PX).
   * @param {number} [options.dpadGapPx]    Gap between D-pad buttons in CSS px (default 8).
   * @param {number} [options.chromePx]     Fixed vertical budget for HUD, gaps,
   *   and padding that sits outside the canvas + D-pad (default 0).
   * @returns {FitResult}
   */
  static computeFit(viewportWidth, viewportHeight, options = {}) {
    const {
      aspect: aspectIn,
      mazeWidth,
      mazeHeight,
      minButtonPx = DPAD_MIN_TOUCH_PX,
      dpadGapPx = 8,
      chromePx = 0,
    } = options;

    // Resolve the maze aspect ratio (width / height). Guard against bad input
    // so the computation always returns finite, non-negative sizes.
    let aspect = aspectIn;
    if (!(aspect > 0)) {
      if (mazeWidth > 0 && mazeHeight > 0) {
        aspect = mazeWidth / mazeHeight;
      }
    }

    const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
    const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;

    // Minimum D-pad footprint: a 3x3 cross is 3 button rows/cols plus 2 gaps.
    const buttonSize = Math.max(0, minButtonPx);
    const dpadSize = buttonSize * 3 + dpadGapPx * 2;

    // Degenerate inputs: no sensible aspect or no viewport -> nothing fits.
    if (!(aspect > 0) || vw <= 0 || vh <= 0) {
      return { canvasWidth: 0, canvasHeight: 0, dpadSize, buttonSize, fits: false };
    }

    // Width constraint: the canvas render width is at most the viewport width
    // (Req 7.6). Below the responsive breakpoint we also keep it within the
    // breakpoint so scaling stays mobile-first.
    const widthCap =
      vw <= RESPONSIVE_MAX_WIDTH_PX ? Math.min(vw, RESPONSIVE_MAX_WIDTH_PX) : vw;

    // Height constraint: canvas height must leave room for the D-pad and the
    // fixed chrome budget within the viewport, so the page does not scroll
    // (Req 10.1). Derive the canvas width that would exactly fill the remaining
    // height, given the aspect ratio.
    const availHeightForCanvas = vh - dpadSize - chromePx;

    let canvasWidth = widthCap;
    let canvasHeight = canvasWidth / aspect;

    if (canvasHeight > availHeightForCanvas) {
      // Too tall: clamp by height instead (preserving aspect ratio).
      canvasHeight = Math.max(0, availHeightForCanvas);
      canvasWidth = canvasHeight * aspect;
    }

    // It fits when the D-pad plus chrome leave a positive canvas area and the
    // final canvas is within both the width cap and the viewport width.
    const fits =
      canvasWidth > 0 &&
      canvasHeight > 0 &&
      canvasWidth <= widthCap + 1e-6 &&
      canvasWidth <= vw + 1e-6 &&
      canvasHeight + dpadSize + chromePx <= vh + 1e-6;

    return { canvasWidth, canvasHeight, dpadSize, buttonSize, fits };
  }

  /**
   * Reads the fixed layout inputs from the live DOM/maze (maze aspect ratio
   * and the current chrome/gap budget) so {@link Layout.computeFit} can be
   * called with real values during {@link Layout#apply}.
   * @param {number} viewportHeight
   * @returns {{ aspect: number|undefined, dpadGapPx: number, chromePx: number }}
   */
  _measureInputs(viewportHeight) {
    const aspect =
      this.maze && this.maze.width > 0 && this.maze.height > 0
        ? this.maze.width / this.maze.height
        : undefined;

    let dpadGapPx = 8;
    let chromePx = 0;

    // Read the D-pad gap from CSS when a DOM is available; fall back to 8px.
    if (typeof getComputedStyle === 'function' && this.dpadRoot) {
      const style = getComputedStyle(this.dpadRoot);
      const gap = parseFloat(style.gap || style.gridGap || '');
      if (Number.isFinite(gap)) dpadGapPx = gap;
    }

    // The chrome budget is whatever vertical space the viewport reserves for
    // the HUD, outer padding, and inter-element gaps that are not the canvas
    // or the D-pad. Approximate it from the HUD element height when present.
    if (typeof document !== 'undefined' && document) {
      const hud = document.getElementById('hud');
      if (hud && typeof hud.getBoundingClientRect === 'function') {
        const rect = hud.getBoundingClientRect();
        if (rect && Number.isFinite(rect.height)) chromePx += rect.height;
      }
    }

    return { aspect, dpadGapPx, chromePx };
  }

  /**
   * Runs the pure fit computation for the given viewport and writes the
   * resulting CSS sizes onto the canvas and D-pad elements. No-op on the
   * canvas/D-pad writes when those elements are absent (e.g. in a DOM-free
   * test), but still returns the computed {@link FitResult}.
   * @param {number} viewportWidth
   * @param {number} viewportHeight
   * @returns {FitResult}
   */
  apply(viewportWidth, viewportHeight) {
    const { aspect, dpadGapPx, chromePx } = this._measureInputs(viewportHeight);

    const fit = Layout.computeFit(viewportWidth, viewportHeight, {
      aspect,
      mazeWidth: this.maze ? this.maze.width : undefined,
      mazeHeight: this.maze ? this.maze.height : undefined,
      dpadGapPx,
      chromePx,
    });

    if (this.canvas && this.canvas.style) {
      this.canvas.style.width = `${fit.canvasWidth}px`;
      this.canvas.style.height = `${fit.canvasHeight}px`;
    }

    if (this.dpadRoot && this.dpadRoot.style) {
      this.dpadRoot.style.width = `${fit.dpadSize}px`;
      this.dpadRoot.style.height = `${fit.dpadSize}px`;
    }

    return fit;
  }

  /**
   * Reads the current viewport box from the environment and applies the layout.
   * @returns {FitResult|null}
   */
  reflow() {
    if (typeof window === 'undefined' || !window) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return this.apply(vw, vh);
  }

  /**
   * Schedules a debounced reflow. Collapses a burst of resize/orientation
   * events into a single reflow that completes within ORIENTATION_REFLOW_MS
   * (Req 10.5).
   * @private
   */
  _scheduleReflow() {
    if (this._debounceTimer != null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.reflow();
    }, RESIZE_DEBOUNCE_MS);
  }

  /**
   * Performs an initial layout and attaches a debounced resize /
   * orientationchange handler. Idempotent: a second attach() while already
   * attached is a no-op. No-op when no window is available.
   */
  attach() {
    if (this._attached) return;
    if (typeof window === 'undefined' || !window) return;

    // Initial layout before any events fire.
    this.reflow();

    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._attached = true;
  }

  /**
   * Removes the resize/orientationchange handler and cancels any pending
   * debounced reflow. Idempotent: safe to call when not attached.
   */
  detach() {
    if (this._debounceTimer != null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (typeof window !== 'undefined' && window) {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
    }
    this._attached = false;
  }
}
