// test/assetLoader.property.test.js
//
// Property-based test for the sprite asset loader (task 13.2).
//
// Covers design Property 25 "Sprite load failures resolve to a playable
// fallback": for all sprite load failures (an `error` event or a timeout at
// SPRITE_TIMEOUT_MS), `loadSprite` resolves (never rejects) with
// `{ status: 'fallback', image: null }`, letting the game reach a playable
// ready state. Also verifies the successful path resolves
// `{ status: 'loaded', image }`.
//
// The loader accepts injectable options { ImageCtor, setTimeout, clearTimeout }
// so error and timeout are simulated without a real DOM: a fake Image records
// its `src`/handlers, and a controllable timer lets the test decide whether the
// timeout fires before the image settles.
//
// Validates: Requirements 9.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { loadSprite } from '../src/assetLoader.js';

/**
 * A controllable timer. `schedule`/`cancel` match the loader's injectable
 * setTimeout/clearTimeout signatures; `fire()` invokes the pending callback
 * exactly once (emulating the timeout elapsing) if it has not been cancelled.
 */
function makeTimer() {
  const pending = new Map();
  let nextHandle = 1;
  return {
    scheduled: pending,
    schedule(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { fn, ms });
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
    fire() {
      // Fire the earliest-scheduled still-pending timer, if any.
      const [handle, entry] = pending.entries().next().value ?? [];
      if (handle == null) return false;
      pending.delete(handle);
      entry.fn();
      return true;
    },
  };
}

/**
 * Build a fake Image constructor. Setting `.src` triggers the configured
 * `outcome` on a microtask so the loader's handlers (attached before `src`)
 * are in place. `outcome` is one of 'load' | 'error' | 'never'. When 'never',
 * the image never settles on its own, leaving the timeout to win.
 */
function makeImageCtor(outcome) {
  const instances = [];
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
      instances.push(this);
    }
    set src(value) {
      this._src = value;
      if (outcome === 'never') return;
      // Fire asynchronously, after the loader attaches handlers and schedules
      // the timeout, mirroring a real async image load.
      Promise.resolve().then(() => {
        if (outcome === 'load' && typeof this.onload === 'function') {
          this.onload();
        } else if (outcome === 'error' && typeof this.onerror === 'function') {
          this.onerror();
        }
      });
    }
    get src() {
      return this._src;
    }
  }
  return { FakeImage, instances };
}

// Feature: pacman-hamster, Property 25: Sprite load failures resolve to a playable fallback
describe('Property 25: Sprite load failures resolve to a playable fallback', () => {
  // Arbitrary relative-looking asset paths and timeout values.
  const pathArb = fc
    .webPath()
    .map((p) => `./assets/${p.replace(/^\/+/, '') || 'hamster'}.png`);
  const timeoutArb = fc.integer({ min: 0, max: 60_000 });

  it('resolves to { status: "fallback", image: null } on an error event, never rejecting', async () => {
    await fc.assert(
      fc.asyncProperty(pathArb, timeoutArb, async (path, timeoutMs) => {
        const timer = makeTimer();
        const { FakeImage } = makeImageCtor('error');

        const result = await loadSprite(path, timeoutMs, {
          ImageCtor: FakeImage,
          setTimeout: timer.schedule.bind(timer),
          clearTimeout: timer.cancel.bind(timer),
        });

        expect(result).toEqual({ status: 'fallback', image: null });
        // The timeout timer was cancelled once the error settled the promise.
        expect(timer.scheduled.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('resolves to { status: "fallback", image: null } on timeout, never rejecting', async () => {
    await fc.assert(
      fc.asyncProperty(pathArb, timeoutArb, async (path, timeoutMs) => {
        const timer = makeTimer();
        // 'never' => the image does not settle on its own, so the timeout wins.
        const { FakeImage } = makeImageCtor('never');

        const promise = loadSprite(path, timeoutMs, {
          ImageCtor: FakeImage,
          setTimeout: timer.schedule.bind(timer),
          clearTimeout: timer.cancel.bind(timer),
        });

        // Let the loader attach handlers and schedule its timeout.
        await Promise.resolve();
        // The loader scheduled exactly one timeout.
        expect(timer.scheduled.size).toBe(1);
        // Elapse the timeout.
        timer.fire();

        const result = await promise;
        expect(result).toEqual({ status: 'fallback', image: null });
      }),
      { numRuns: 100 },
    );
  });

  it('resolves to { status: "loaded", image } on a successful load', async () => {
    await fc.assert(
      fc.asyncProperty(pathArb, timeoutArb, async (path, timeoutMs) => {
        const timer = makeTimer();
        const { FakeImage, instances } = makeImageCtor('load');

        const result = await loadSprite(path, timeoutMs, {
          ImageCtor: FakeImage,
          setTimeout: timer.schedule.bind(timer),
          clearTimeout: timer.cancel.bind(timer),
        });

        expect(result.status).toBe('loaded');
        expect(result.image).toBe(instances[0]);
        expect(result.image).not.toBeNull();
        // The requested relative path was used as the image source.
        expect(result.image.src).toBe(path);
        // The pending timeout was cancelled once the load settled.
        expect(timer.scheduled.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
