// src/main.js
//
// Bootstrap and fixed-timestep game loop for PacHuat (task 17.1).
//
// This module is the entry point loaded by index.html via
// `<script type="module" src="./src/main.js">`. It wires the DOM-free
// simulation (game.js) to the I/O layers (input/D-pad, layout, renderer, asset
// loader) and drives them with a fixed-timestep loop:
//
//   - Obtain the canvas 2D context. On a null context (Req 7.7) render a
//     plain-DOM error message and DO NOT start the loop or construct the
//     simulation.
//   - Kick off loadSprite (relative path + fallback, Req 9.2-9.4). Once it
//     resolves (loaded or fallback), build the Game, InputHandler, DPad,
//     Layout, and Renderer; show the start prompt (and a fallback notice when
//     applicable) and gate gameplay on a start input (Req 9.5).
//   - Run a requestAnimationFrame loop with an accumulator at SIM_HZ: each
//     frame advances the simulation zero or more fixed STEP updates
//     (game.update(STEP, intent)) then renders exactly once
//     (renderer.render(game)), keeping the render rate >= 30 FPS (Req 7.1).
//   - Perform the initial layout and attach resize/orientation handling via
//     Layout (Req 7.6, 10.*).
//
// STRUCTURE FOR TESTABILITY (task 17.2 drives this with mocks): the bootstrap
// is exported as `bootstrap(doc, win)` and the loop/step helpers
// (`runFixedSteps`, `createLoop`) are exported too, so an integration test can
// construct them against fake DOM/raf objects, pump frames by hand, and assert
// that each frame renders once and the simulation step rate is sustained, and
// that a null context shows a DOM error and never starts. Every DOM / rAF /
// window access is routed through the injected `doc`/`win` (defaulting to the
// real globals when present) and guarded so the module imports cleanly under
// jsdom or a bare Node test environment.
//
// Requirements: 7.1, 7.7, 9.5

import { CONFIG } from './constants.js';
import { loadSprite, DEFAULT_SPRITE_PATH } from './assetLoader.js';
import { Game } from './game.js';
import { InputHandler } from './input.js';
import { DPad } from './dpad.js';
import { Layout } from './layout.js';
import { Renderer } from './renderer.js';

/**
 * Fixed simulation timestep in milliseconds. Derived from the configured
 * simulation rate (SIM_HZ) so one `game.update(STEP, intent)` call advances the
 * world by exactly 1 / SIM_HZ seconds. The loop's accumulator runs this step
 * zero or more times per animation frame to decouple simulation from frame
 * rate (Req 7.1).
 * @type {number}
 */
export const STEP = 1000 / CONFIG.SIM_HZ;

/**
 * Upper bound on how much wall-clock time a single frame may contribute to the
 * accumulator. Without a clamp, a long pause (tab backgrounded, breakpoint)
 * would queue a huge backlog of fixed steps and freeze the page catching up
 * ("spiral of death"). Capping the frame delta bounds the catch-up work per
 * frame while keeping motion deterministic.
 * @type {number}
 */
export const MAX_FRAME_MS = 250;

/** HUD copy shown while waiting for the player to begin (Req 9.5). */
const START_PROMPT = 'Tap a direction to start';

/** HUD copy shown when the sprite could not load and the fallback is used. */
const FALLBACK_NOTICE = 'fallback graphics in use';

/**
 * Resolves the global `document`, preferring an injected one. Returns null when
 * no document is available (bare Node test), so callers can guard DOM access.
 * @param {Document} [doc]
 * @returns {Document|null}
 */
function resolveDocument(doc) {
  if (doc) return doc;
  return typeof document !== 'undefined' ? document : null;
}

/**
 * Resolves the global `window`, preferring an injected one. Returns null when
 * no window is available, so callers can guard rAF / resize access.
 * @param {Window} [win]
 * @returns {Window|null}
 */
function resolveWindow(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Renders a plain-DOM error message into the page when the canvas 2D context
 * cannot be obtained (Req 7.7). Uses only basic DOM APIs so it works even when
 * canvas rendering is unavailable; best-effort and never throws.
 *
 * @param {Document|null} doc The document to render into.
 * @param {string} message The user-facing error text.
 * @returns {void}
 */
export function renderContextError(doc, message) {
  if (!doc) return;
  try {
    const host = doc.getElementById('message') || doc.getElementById('hud') || doc.body;
    if (!host) return;
    // Prefer the dedicated message element's text channel so the aria-live HUD
    // announces it; otherwise append a new element so nothing is overwritten.
    if (host.id === 'message') {
      host.textContent = message;
    } else {
      const el = doc.createElement('div');
      el.className = 'game-error';
      el.setAttribute('role', 'alert');
      el.textContent = message;
      host.appendChild(el);
    }
  } catch {
    // Swallow: the error path must never itself throw.
  }
}

/**
 * Advances the simulation by as many whole fixed steps as the accumulator
 * holds, consuming STEP milliseconds per call to `game.update`. Returns the
 * leftover accumulator (always in [0, STEP)) and the number of steps run.
 *
 * This is the pure core of the fixed-timestep loop, pulled out so the
 * integration test can assert the step rate directly: feeding N*STEP of
 * accumulated time runs exactly N updates with the given intent.
 *
 * @param {{ update: (stepMs: number, intent: any) => void }} game The
 *   simulation to advance.
 * @param {number} accumulatorMs Milliseconds of unsimulated time banked so far.
 * @param {('up'|'down'|'left'|'right'|null)} intent Current movement intent.
 * @param {number} [stepMs=STEP] Fixed timestep size.
 * @param {number} [maxSteps=1000] Safety cap on steps per call to bound work.
 * @returns {{ accumulator: number, steps: number }}
 */
export function runFixedSteps(game, accumulatorMs, intent, stepMs = STEP, maxSteps = 1000) {
  let accumulator = accumulatorMs;
  let steps = 0;
  while (accumulator >= stepMs && steps < maxSteps) {
    game.update(stepMs, intent);
    accumulator -= stepMs;
    steps += 1;
  }
  return { accumulator, steps };
}

/**
 * Builds a fixed-timestep animation loop over `requestAnimationFrame`. The
 * returned controller exposes `start()`, `stop()`, and a `frame(timestamp)`
 * method the test can call directly with synthetic timestamps to pump frames
 * deterministically (no real rAF needed).
 *
 * On each frame it banks the clamped wall-clock delta into an accumulator, runs
 * zero or more fixed `game.update(STEP, intent)` steps via {@link runFixedSteps}
 * (reading the live intent from `getIntent` each frame), then renders exactly
 * once with `renderer.render(game)` (Req 7.1).
 *
 * @param {Object} params
 * @param {{ update: Function }} params.game The simulation.
 * @param {{ render: (game: any) => void }} params.renderer The renderer.
 * @param {() => ('up'|'down'|'left'|'right'|null)} params.getIntent Supplies the
 *   current movement intent at the start of each frame.
 * @param {(cb: (timestamp: number) => void) => any} params.requestFrame
 *   requestAnimationFrame-like scheduler.
 * @param {(handle: any) => void} [params.cancelFrame] cancelAnimationFrame-like
 *   canceller (optional).
 * @param {number} [params.stepMs=STEP] Fixed timestep.
 * @returns {{ start: () => void, stop: () => void, frame: (timestamp: number) => void, isRunning: () => boolean }}
 */
export function createLoop({
  game,
  renderer,
  getIntent,
  requestFrame,
  cancelFrame,
  onFrame,
  stepMs = STEP,
}) {
  let accumulator = 0;
  let lastTimestamp = null;
  let running = false;
  let rafHandle = null;

  const readIntent = typeof getIntent === 'function' ? getIntent : () => null;

  /**
   * Advances one frame given a monotonically increasing timestamp (ms).
   * @param {number} timestamp
   */
  function frame(timestamp) {
    const now = Number.isFinite(timestamp) ? timestamp : 0;

    if (lastTimestamp == null) {
      // First frame establishes the clock; no simulation time has elapsed yet.
      lastTimestamp = now;
    }

    // Clamp the delta so a long pause cannot queue an unbounded step backlog.
    let delta = now - lastTimestamp;
    if (!(delta >= 0)) delta = 0; // guard against non-monotonic timestamps
    if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS;
    lastTimestamp = now;

    accumulator += delta;
    const result = runFixedSteps(game, accumulator, readIntent(), stepMs);
    accumulator = result.accumulator;

    // Exactly one render per frame (Req 7.1).
    renderer.render(game);

    // Per-frame UI hook (e.g. toggling the restart button on win/loss).
    if (typeof onFrame === 'function') onFrame(game);

    if (running && typeof requestFrame === 'function') {
      rafHandle = requestFrame(frame);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTimestamp = null;
      accumulator = 0;
      if (typeof requestFrame === 'function') {
        rafHandle = requestFrame(frame);
      }
    },
    stop() {
      running = false;
      if (rafHandle != null && typeof cancelFrame === 'function') {
        cancelFrame(rafHandle);
      }
      rafHandle = null;
    },
    frame,
    isRunning() {
      return running;
    },
  };
}

/**
 * @typedef {Object} BootstrapResult
 * @property {boolean} started Whether the game loop was started. False when the
 *   2D context was unavailable (Req 7.7).
 * @property {string} [error] A short machine-readable reason when not started.
 * @property {Game} [game] The constructed simulation (present when started).
 * @property {InputHandler} [input] The input handler (present when started).
 * @property {Renderer} [renderer] The renderer (present when started).
 * @property {Layout} [layout] The layout controller (present when started).
 * @property {{ start: Function, stop: Function, frame: Function }} [loop]
 *   The loop controller (present when started).
 * @property {Promise<any>} [ready] Resolves once sprite loading settles and the
 *   game is wired and the loop started.
 */

/**
 * Boots the game: wires DOM, simulation, input, layout, and rendering, then
 * starts the fixed-timestep loop. Safe to call under jsdom or a bare Node test
 * via the injected `doc`/`win`.
 *
 * Context-failure path (Req 7.7): if the canvas element is missing or its 2D
 * context is null, a plain-DOM error message is rendered and bootstrap returns
 * immediately with `{ started: false }` — the simulation is never constructed
 * and no loop runs.
 *
 * Success path: `loadSprite` is kicked off (never rejects, Req 9.3). Once it
 * settles, the Game/Input/DPad/Layout/Renderer are built, the HUD shows the
 * start prompt (plus a fallback notice when the sprite fell back, Req 9.4), the
 * initial layout is applied and resize/orientation handling attached, and the
 * loop starts. Gameplay is gated on a start input: the first D-pad tap both
 * sets the movement intent and calls `game.start()` (ready -> playing, Req 9.5).
 *
 * @param {Document} [doc=document] Document to operate on.
 * @param {Window} [win=window] Window providing rAF and resize events.
 * @param {Object} [options] Injectable dependencies for testing.
 * @param {typeof loadSprite} [options.loadSpriteFn] Sprite loader override.
 * @param {string} [options.spritePath] Sprite path override.
 * @returns {BootstrapResult}
 */
export function bootstrap(doc = resolveDocument(), win = resolveWindow(), options = {}) {
  const document_ = resolveDocument(doc);
  const window_ = resolveWindow(win);
  const loadSpriteFn = options.loadSpriteFn ?? loadSprite;
  const spritePath = options.spritePath ?? DEFAULT_SPRITE_PATH;

  // --- DOM lookups --------------------------------------------------------
  const canvas = document_ ? document_.getElementById('game-canvas') : null;

  // Context-acquisition failure (Req 7.7): no canvas element, or getContext
  // returns null. Render a plain-DOM error and do not start anything.
  if (!canvas || typeof canvas.getContext !== 'function') {
    renderContextError(
      document_,
      'Unable to start the game: no drawing canvas is available.',
    );
    return { started: false, error: 'no-canvas' };
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    renderContextError(
      document_,
      'Unable to start the game: the canvas 2D context is unavailable.',
    );
    return { started: false, error: 'no-context' };
  }

  const dpadRoot = document_ ? document_.getElementById('dpad') : null;
  const messageEl = document_ ? document_.getElementById('message') : null;
  const restartEl = document_ ? document_.getElementById('restart') : null;

  // --- Simulation + I/O wiring -------------------------------------------
  const game = new Game();

  // The D-pad is the sole input source. The InputHandler owns the DPad and
  // forwards its taps into the current movement intent.
  const dpad = new DPad(dpadRoot, {});
  const input = new InputHandler({ dpad });

  // Gate gameplay on a start input (Req 9.5): the first directional tap begins
  // play. We wrap the D-pad's onDirection so every tap updates the intent AND,
  // on the first tap while `ready`, transitions the game to `playing`.
  dpad.onDirection = (direction) => {
    input.setFromDpad(direction);
    game.start(); // no-op unless mode === 'ready'
  };
  dpad.attach();

  // Restart control (Req 6.4): visible only on win/loss. A tap rebuilds a
  // fresh session via game.restart() (mode -> 'ready'), clears the pending
  // movement intent, restores the start prompt, and hides the button again.
  // Gameplay then resumes on the next D-pad tap, exactly like a fresh load.
  function handleRestart(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    game.restart();
    input.setFromDpad(null);
    setMessage(messageEl, spriteFellBack ? `${START_PROMPT} \u2014 ${FALLBACK_NOTICE}` : START_PROMPT);
    setRestartVisible(restartEl, false);
  }
  if (restartEl && typeof restartEl.addEventListener === 'function') {
    restartEl.addEventListener('click', handleRestart);
    restartEl.addEventListener('touchstart', handleRestart, { passive: false });
  }

  // Responsive layout over the canvas + D-pad (Req 7.6, 10.*). attach() does
  // the initial reflow and wires resize/orientationchange. No-op without a
  // window, so it stays safe under a bare Node test.
  const layout = new Layout(canvas, dpadRoot, game.maze);
  if (window_) {
    layout.attach();
  }

  // Show the start prompt immediately; the fallback notice (if any) is added
  // once sprite loading settles.
  setMessage(messageEl, START_PROMPT);

  // Renderer is created after the sprite settles so it knows whether to draw
  // the sprite or the colored-shape fallback. Declared here so the loop and the
  // returned result can reference it once built.
  /** @type {Renderer|null} */
  let renderer = null;
  let spriteFellBack = false;

  const requestFrame = resolveRequestFrame(window_);
  const cancelFrame = resolveCancelFrame(window_);

  /** @type {ReturnType<typeof createLoop>|null} */
  let loop = null;

  const result = {
    started: true,
    game,
    input,
    layout,
    get renderer() {
      return renderer;
    },
    get loop() {
      return loop;
    },
  };

  // Kick off sprite loading. loadSprite never rejects (Req 9.3): it resolves
  // 'loaded' with an image or 'fallback' with null. Either way we proceed to a
  // ready, playable state (Req 9.5).
  result.ready = Promise.resolve(loadSpriteFn(spritePath, CONFIG.SPRITE_TIMEOUT_MS))
    .then((spriteResult) => {
      const sprite =
        spriteResult && spriteResult.status === 'loaded' ? spriteResult.image : null;
      spriteFellBack = sprite == null;

      renderer = new Renderer(ctx, sprite);

      // Surface the fallback notice when the sprite failed to load (Req 9.4),
      // alongside the start prompt that gates gameplay (Req 9.5).
      if (sprite == null) {
        setMessage(messageEl, `${START_PROMPT} — ${FALLBACK_NOTICE}`);
      } else {
        setMessage(messageEl, START_PROMPT);
      }

      loop = createLoop({
        game,
        renderer,
        getIntent: () => input.intent,
        requestFrame,
        cancelFrame,
        onFrame: (g) => setRestartVisible(restartEl, g.mode === 'won' || g.mode === 'lost'),
      });
      loop.start();

      return result;
    });

  return result;
}

/**
 * Sets the HUD message element's text when it exists; a no-op otherwise so the
 * bootstrap stays safe when the HUD markup or document is absent.
 * @param {Element|null} messageEl
 * @param {string} text
 * @returns {void}
 */
function setMessage(messageEl, text) {
  if (messageEl) messageEl.textContent = text;
}

/**
 * Shows or hides the restart button by toggling its `hidden` property.
 * No-op when the element is absent, keeping bootstrap safe without the HUD.
 * @param {Element|null} restartEl
 * @param {boolean} visible
 * @returns {void}
 */
function setRestartVisible(restartEl, visible) {
  if (restartEl) restartEl.hidden = !visible;
}

/**
 * Resolves a requestAnimationFrame-like scheduler bound to the window, falling
 * back to a setTimeout shim (~60 Hz) when rAF is unavailable so the loop still
 * advances under a bare test environment.
 * @param {Window|null} window_
 * @returns {(cb: (timestamp: number) => void) => any}
 */
function resolveRequestFrame(window_) {
  if (window_ && typeof window_.requestAnimationFrame === 'function') {
    return window_.requestAnimationFrame.bind(window_);
  }
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame;
  }
  // Fallback: approximate 60 FPS with setTimeout, passing a wall-clock-ish
  // timestamp so the accumulator still advances.
  return (cb) => setTimeout(() => cb(Date.now()), 1000 / CONFIG.SIM_HZ);
}

/**
 * Resolves a cancelAnimationFrame-like canceller bound to the window, falling
 * back to clearTimeout to match the setTimeout scheduler shim.
 * @param {Window|null} window_
 * @returns {(handle: any) => void}
 */
function resolveCancelFrame(window_) {
  if (window_ && typeof window_.cancelAnimationFrame === 'function') {
    return window_.cancelAnimationFrame.bind(window_);
  }
  if (typeof cancelAnimationFrame === 'function') {
    return cancelAnimationFrame;
  }
  return (handle) => clearTimeout(handle);
}

// Auto-bootstrap when loaded as the page entry point (a real browser provides
// `document` and `window`). Guarded so importing this module in a test (jsdom
// or bare Node) does NOT auto-start — tests call bootstrap() explicitly with
// their own mocks. The marker property lets a jsdom test opt out of auto-start.
if (
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  !(typeof window !== 'undefined' && window.__PACHUAT_NO_AUTOBOOT__)
) {
  // Defer to DOMContentLoaded when the DOM is still parsing so the canvas and
  // D-pad markup exist before we look them up.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap());
  } else {
    bootstrap();
  }
}
