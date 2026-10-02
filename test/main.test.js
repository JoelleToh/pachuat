// test/main.test.js
//
// Integration tests for the bootstrap + fixed-timestep game loop (task 17.2).
//
//   - Req 7.1 : the loop renders exactly once per animation frame and sustains
//               the fixed simulation step rate — over elapsed wall-clock time T
//               the number of game.update calls equals floor(accumulated/STEP).
//               Verified both at the loop level (createLoop + a controllable
//               requestFrame, mock game/renderer) and directly against the pure
//               step core (runFixedSteps).
//   - Req 7.7 : when the canvas 2D context cannot be obtained (null context, or
//               the canvas element missing entirely) bootstrap renders a
//               plain-DOM error message and does NOT start the loop or the
//               simulation (started === false, no renderer, loader untouched).
//
// These exercise only the exported seams of src/main.js (bootstrap, createLoop,
// runFixedSteps, renderContextError, STEP, MAX_FRAME_MS) with lightweight fake
// DOM / rAF objects, so no real browser or jsdom is required and the module is
// imported with autoboot suppressed.

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Suppress the module's auto-bootstrap in case a global document/window ever
// exists in the test environment (this file runs under the default Node
// environment where neither is defined, but the flag is cheap insurance and
// documents the contract from the module header).
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = { __PACHUAT_NO_AUTOBOOT__: true };
  } else {
    globalThis.window.__PACHUAT_NO_AUTOBOOT__ = true;
  }
});

const {
  bootstrap,
  createLoop,
  runFixedSteps,
  renderContextError,
  STEP,
  MAX_FRAME_MS,
} = await import('../src/main.js');

// ---------------------------------------------------------------------------
// Fake DOM helpers
// ---------------------------------------------------------------------------

/**
 * A minimal stub DOM element that records text and appended children, enough
 * for renderContextError and the HUD message channel. Supports the subset of
 * the Element API bootstrap touches.
 */
function createStubElement(id = '') {
  return {
    id,
    textContent: '',
    className: '',
    children: [],
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

/**
 * Builds a fake document whose getElementById resolves a fixed map of elements.
 * createElement returns fresh stub elements so renderContextError's appendChild
 * path works. A #message, #hud and body element are always present so the error
 * path has somewhere to write.
 *
 * @param {Object} [opts]
 * @param {Object|null} [opts.canvas] The element returned for 'game-canvas'.
 *   When omitted the canvas is absent (missing-canvas case).
 */
function createFakeDoc({ canvas } = {}) {
  const message = createStubElement('message');
  const hud = createStubElement('hud');
  const dpad = createStubElement('dpad');
  const body = createStubElement('body');

  const byId = {
    message,
    hud,
    dpad,
    body,
  };
  if (canvas !== undefined) {
    byId['game-canvas'] = canvas;
  }

  return {
    body,
    _elements: byId,
    getElementById(id) {
      return byId[id] ?? null;
    },
    createElement() {
      return createStubElement();
    },
  };
}

/** A fake window exposing rAF/cancel + resize wiring that bootstrap tolerates. */
function createFakeWin() {
  return {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 400,
    innerHeight: 800,
  };
}

/**
 * A controllable requestAnimationFrame: captures the scheduled callback so the
 * test can pump frames by hand with synthetic timestamps. Does NOT invoke the
 * callback automatically, so each frame is deliberate.
 */
function createManualRaf() {
  let pending = null;
  let handle = 0;
  return {
    requestFrame(cb) {
      pending = cb;
      return ++handle;
    },
    cancelFrame() {
      pending = null;
    },
    /** Runs the most recently scheduled frame callback with a timestamp. */
    tick(timestamp) {
      const cb = pending;
      pending = null;
      if (cb) cb(timestamp);
    },
    hasPending() {
      return pending != null;
    },
  };
}

// ---------------------------------------------------------------------------
// Req 7.1 — loop renders each frame and sustains the simulation step rate
// ---------------------------------------------------------------------------

describe('createLoop — renders each frame and sustains the step rate (Req 7.1)', () => {
  it('renders exactly once per frame and sustains ~accumulated/STEP updates', () => {
    const game = { update: vi.fn() };
    const renderer = { render: vi.fn() };
    const raf = createManualRaf();

    const loop = createLoop({
      game,
      renderer,
      getIntent: () => 'left',
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });

    loop.start();
    // start() schedules the first frame via requestFrame.
    expect(raf.hasPending()).toBe(true);

    // Advance frames with timestamps that are not multiples of STEP so the
    // accumulator carries leftover time between frames. Elapsed from the first
    // frame's clock baseline, not from zero.
    const timestamps = [0, 20, 55, 70, 123, 200];
    for (const t of timestamps) {
      raf.tick(t);
    }

    const framesPumped = timestamps.length;
    // One render per frame (Req 7.1).
    expect(renderer.render).toHaveBeenCalledTimes(framesPumped);

    // The first frame establishes the clock (no elapsed time), so accumulated
    // simulated time is the last timestamp minus the first. "Sustains the step
    // rate" means the total updates track accumulated/STEP: over the whole run
    // the loop neither drops nor invents simulation time beyond the sub-STEP
    // remainder it legitimately carries. Because the accumulator is summed
    // incrementally across frames, the exact count can differ from a single
    // floor(total/STEP) by at most one step at a boundary, so we assert the
    // tight bound rather than brittle equality.
    const accumulated = timestamps[timestamps.length - 1] - timestamps[0];
    const idealUpdates = accumulated / STEP;
    const actualUpdates = game.update.mock.calls.length;
    expect(actualUpdates).toBeLessThanOrEqual(Math.ceil(idealUpdates));
    expect(actualUpdates).toBeGreaterThanOrEqual(Math.floor(idealUpdates) - 1);

    // Every update used the live intent supplied by getIntent.
    for (const call of game.update.mock.calls) {
      expect(call[0]).toBe(STEP);
      expect(call[1]).toBe('left');
    }

    // The loop keeps scheduling itself while running.
    expect(raf.hasPending()).toBe(true);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it('reads the intent live each frame so the most recent intent is used', () => {
    const game = { update: vi.fn() };
    const renderer = { render: vi.fn() };
    const raf = createManualRaf();
    let intent = 'up';

    const loop = createLoop({
      game,
      renderer,
      getIntent: () => intent,
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });

    loop.start();
    raf.tick(0); // baseline frame, no updates yet
    raf.tick(STEP); // one update with 'up'
    intent = 'down';
    raf.tick(STEP * 2); // one update with 'down'

    const intentsUsed = game.update.mock.calls.map((c) => c[1]);
    expect(intentsUsed).toEqual(['up', 'down']);
  });

  it('clamps a huge frame delta to MAX_FRAME_MS to avoid a step backlog', () => {
    const game = { update: vi.fn() };
    const renderer = { render: vi.fn() };
    const raf = createManualRaf();

    const loop = createLoop({
      game,
      renderer,
      getIntent: () => null,
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });

    loop.start();
    raf.tick(0); // baseline
    raf.tick(10_000_000); // enormous jump (e.g. backgrounded tab)

    // Delta is clamped to MAX_FRAME_MS, bounding the catch-up work: at most as
    // many whole STEPs as the cap holds (derived with the loop's own
    // arithmetic so it matches at floating-point boundaries).
    const expected = runFixedSteps({ update() {} }, MAX_FRAME_MS, null).steps;
    expect(game.update).toHaveBeenCalledTimes(expected);
    expect(expected).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_MS / STEP));
    // Still exactly one render per frame.
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});

describe('runFixedSteps — pure fixed-step core (Req 7.1)', () => {
  it('runs exactly N updates for N whole STEPs accumulated with the given intent', () => {
    const game = { update: vi.fn() };
    const N = 7;
    // Bank N whole steps plus a tiny slice so the Nth step is unambiguously
    // reached despite STEP (1000/60) being non-terminating in binary — the
    // slice is far below one STEP so it cannot produce an extra update.
    const slice = STEP * 1e-6;

    const { accumulator, steps } = runFixedSteps(game, N * STEP + slice, 'right');

    expect(steps).toBe(N);
    expect(game.update).toHaveBeenCalledTimes(N);
    for (const call of game.update.mock.calls) {
      expect(call[0]).toBe(STEP);
      expect(call[1]).toBe('right');
    }
    // Leftover is the sub-STEP slice: still in [0, STEP).
    expect(accumulator).toBeGreaterThanOrEqual(0);
    expect(accumulator).toBeLessThan(STEP);
  });

  it('leaves a leftover accumulator in [0, STEP)', () => {
    const game = { update: vi.fn() };
    const leftoverIn = STEP * 0.37;

    const { accumulator, steps } = runFixedSteps(game, 3 * STEP + leftoverIn, null);

    expect(steps).toBe(3);
    expect(accumulator).toBeGreaterThanOrEqual(0);
    expect(accumulator).toBeLessThan(STEP);
    expect(accumulator).toBeCloseTo(leftoverIn, 9);
  });

  it('runs zero updates when the accumulator is below one STEP', () => {
    const game = { update: vi.fn() };
    const { accumulator, steps } = runFixedSteps(game, STEP - 0.001, 'up');
    expect(steps).toBe(0);
    expect(game.update).not.toHaveBeenCalled();
    expect(accumulator).toBeCloseTo(STEP - 0.001, 9);
  });

  it('honors the maxSteps safety cap', () => {
    const game = { update: vi.fn() };
    const { steps } = runFixedSteps(game, 1000 * STEP, null, STEP, 5);
    expect(steps).toBe(5);
    expect(game.update).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// Req 7.7 — a null canvas context shows an error and does not start
// ---------------------------------------------------------------------------

describe('bootstrap — null canvas context does not start (Req 7.7)', () => {
  it('shows an error and does not start when getContext returns null', () => {
    const canvas = {
      getContext: vi.fn(() => null),
      addEventListener() {},
      style: {},
    };
    const doc = createFakeDoc({ canvas });
    const win = createFakeWin();
    const loadSpriteFn = vi.fn(() => Promise.resolve({ status: 'loaded', image: {} }));

    const result = bootstrap(doc, win, { loadSpriteFn });

    // Did not start, and reports the reason.
    expect(result.started).toBe(false);
    expect(result.error).toBe('no-context');
    // No simulation / renderer / loop were constructed.
    expect(result.game).toBeUndefined();
    expect(result.renderer).toBeUndefined();
    expect(result.loop).toBeUndefined();
    // The sprite loader was never invoked — nothing was started.
    expect(loadSpriteFn).not.toHaveBeenCalled();
    // getContext was consulted (and returned null).
    expect(canvas.getContext).toHaveBeenCalledWith('2d');
    // A plain-DOM error message was written into the #message channel.
    expect(doc._elements.message.textContent).toMatch(/unable to start/i);
  });

  it('shows an error and does not start when the canvas element is missing', () => {
    const doc = createFakeDoc(); // no game-canvas
    const win = createFakeWin();
    const loadSpriteFn = vi.fn(() => Promise.resolve({ status: 'fallback', image: null }));

    const result = bootstrap(doc, win, { loadSpriteFn });

    expect(result.started).toBe(false);
    expect(result.error).toBe('no-canvas');
    expect(result.game).toBeUndefined();
    expect(result.renderer).toBeUndefined();
    expect(result.loop).toBeUndefined();
    expect(loadSpriteFn).not.toHaveBeenCalled();
    expect(doc._elements.message.textContent).toMatch(/unable to start/i);
  });

  it('falls back to the body when no #message or #hud host exists', () => {
    // A document whose message/hud lookups miss but body is present: the error
    // is appended as a new alert element rather than overwriting anything.
    const body = createStubElement('body');
    const doc = {
      body,
      getElementById(id) {
        return id === 'body' ? body : null;
      },
      createElement() {
        return createStubElement();
      },
    };

    renderContextError(doc, 'Boom');

    expect(body.children.length).toBe(1);
    const alert = body.children[0];
    expect(alert.textContent).toBe('Boom');
    expect(alert.attributes.role).toBe('alert');
  });

  it('renderContextError never throws without a document', () => {
    expect(() => renderContextError(null, 'x')).not.toThrow();
  });
});
