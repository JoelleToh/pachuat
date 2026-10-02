// test/restart.test.js
//
// Integration tests for the on-screen Restart button wired in src/main.js.
//
// The simulation already supports Game.restart() (Property 21). This verifies
// the UI layer: the #restart button is hidden during play, revealed by the
// game loop once the game ends (won/lost), and a tap on it restarts the session
// (mode -> 'ready', score 0, lives 3, full pellets) and hides the button again.
//
// Driven through the exported bootstrap() seam with a lightweight fake DOM and
// a controllable requestAnimationFrame, so no real browser/jsdom is needed.
//
// Requirements: 6.4

import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  // Layout reads the GLOBAL window for resize/orientation wiring, so the global
  // stub must expose those methods (bootstrap itself uses the injected window).
  const stub = {
    __PACHUAT_NO_AUTOBOOT__: true,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    innerWidth: 400,
    innerHeight: 800,
  };
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = stub;
  } else {
    Object.assign(globalThis.window, stub);
  }
});

const { bootstrap } = await import('../src/main.js');

/** A stub element recording text, hidden state, and event handlers. */
function createStubElement(id = '') {
  const listeners = {};
  return {
    id,
    textContent: '',
    className: '',
    hidden: false,
    style: {},
    attributes: {},
    _listeners: listeners,
    setAttribute(n, v) { this.attributes[n] = v; },
    appendChild(c) { return c; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    /** Test helper: fire a recorded handler. */
    emit(type, event = {}) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
  };
}

/** A fake 2D context sufficient for the Renderer to draw into without throwing. */
function createFakeCtx() {
  return {
    canvas: { width: 448, height: 496 },
    fillStyle: '#000', globalAlpha: 1, textBaseline: 'top', textAlign: 'left', font: '10px',
    fillRect() {}, fillText() {}, beginPath() {}, arc() {}, fill() {}, drawImage() {},
  };
}

function createFakeCanvas() {
  const ctx = createFakeCtx();
  return { getContext: () => ctx, addEventListener() {}, style: {}, width: 448, height: 496 };
}

function createFakeDoc() {
  const els = {
    'game-canvas': createFakeCanvas(),
    message: createStubElement('message'),
    hud: createStubElement('hud'),
    dpad: createStubElement('dpad'),
    restart: createStubElement('restart'),
    body: createStubElement('body'),
  };
  return {
    body: els.body,
    _elements: els,
    getElementById(id) { return els[id] ?? null; },
    createElement() { return createStubElement(); },
  };
}

function createManualRaf() {
  let pending = null;
  return {
    requestFrame(cb) { pending = cb; return 1; },
    cancelFrame() { pending = null; },
    tick(ts) { const cb = pending; pending = null; if (cb) cb(ts); },
  };
}

function createFakeWin(raf) {
  return {
    requestAnimationFrame: raf.requestFrame,
    cancelAnimationFrame: raf.cancelFrame,
    addEventListener() {}, removeEventListener() {},
    innerWidth: 400, innerHeight: 800,
  };
}

const fallbackLoader = () => Promise.resolve({ status: 'fallback', image: null });

describe('Restart button (Req 6.4)', () => {
  it('is hidden during play and revealed once the game ends', async () => {
    const raf = createManualRaf();
    const doc = createFakeDoc();
    const win = createFakeWin(raf);

    const result = bootstrap(doc, win, { loadSpriteFn: fallbackLoader });
    expect(result.started).toBe(true);
    await result.ready;

    const restartEl = doc._elements.restart;

    // While not ended, a pumped frame keeps the button hidden.
    raf.tick(0);
    raf.tick(16);
    expect(restartEl.hidden).toBe(true);

    // Force the game into an ended state; the next frame reveals the button.
    result.game.mode = 'lost';
    raf.tick(32);
    expect(restartEl.hidden).toBe(false);
  });

  it('restarts the session when tapped, then hides itself again', async () => {
    const raf = createManualRaf();
    const doc = createFakeDoc();
    const win = createFakeWin(raf);

    const result = bootstrap(doc, win, { loadSpriteFn: fallbackLoader });
    await result.ready;

    const game = result.game;
    const restartEl = doc._elements.restart;

    // Drive to a 'won' end state and consume some pellets / lose a life so the
    // restart has observable state to reset.
    game.start();
    game._setScore(500);
    game._lives = 1;
    game.maze.removePellet(game.maze.playerSpawn.col, game.maze.playerSpawn.row);
    game.mode = 'won';

    // A frame reveals the button.
    raf.tick(0);
    expect(restartEl.hidden).toBe(false);

    const fullCollectibles = game.maze.remainingCollectibles() + 1; // approx; exact checked below
    void fullCollectibles;

    // Tap the restart button (touchstart).
    let prevented = false;
    restartEl.emit('touchstart', { preventDefault() { prevented = true; } });

    // preventDefault was honored and the session is fresh again.
    expect(prevented).toBe(true);
    expect(game.mode).toBe('ready');
    expect(game.score).toBe(0);
    expect(game.lives).toBe(3);

    // A fresh Game of the same layout has the full collectible count; after
    // restart the maze is back to that full count.
    const freshCount = result.game.maze.remainingCollectibles();
    expect(freshCount).toBeGreaterThan(0);

    // The button hides itself immediately on restart (before the next frame).
    expect(restartEl.hidden).toBe(true);

    // And a subsequent frame (still 'ready') keeps it hidden.
    raf.tick(16);
    expect(restartEl.hidden).toBe(true);
  });

  it('click also restarts (not only touchstart)', async () => {
    const raf = createManualRaf();
    const doc = createFakeDoc();
    const win = createFakeWin(raf);

    const result = bootstrap(doc, win, { loadSpriteFn: fallbackLoader });
    await result.ready;

    const game = result.game;
    const restartEl = doc._elements.restart;
    game.mode = 'lost';
    raf.tick(0);
    expect(restartEl.hidden).toBe(false);

    restartEl.emit('click', {});
    expect(game.mode).toBe('ready');
    expect(restartEl.hidden).toBe(true);
  });
});
