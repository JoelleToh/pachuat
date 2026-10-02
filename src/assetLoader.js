// src/assetLoader.js
//
// Asset loading with timeout and graceful fallback (Req 9.2, 9.3, 9.4).
//
// Loads the hamster sprite over a RELATIVE path (`./assets/hamster.png`) so it
// resolves correctly under a GitHub Pages project subpath. The loader races the
// image load against a timeout and NEVER rejects: on success it resolves
// `{ status: 'loaded', image }`; on an error event or timeout it resolves
// `{ status: 'fallback', image: null }`, letting the game proceed to a ready,
// playable state via the renderer's colored-shape fallback path.
//
// Covers task 13.1. The property test in task 13.2 simulates load error and
// timeout by injecting a custom Image constructor via `options.ImageCtor` and
// controlling time via `options.setTimeout`/`options.clearTimeout`, so the
// pure load/fallback logic can be exercised without a real DOM.

import { CONFIG } from './constants.js';

/**
 * Default relative path to the hamster sprite. Relative (`./...`), never
 * root-absolute, so it resolves under `https://{user}.github.io/{repo}/`
 * (Req 9.2, 9.6).
 * @type {string}
 */
export const DEFAULT_SPRITE_PATH = './assets/hamster.png';

/**
 * @typedef {Object} SpriteResult
 * @property {'loaded'|'fallback'} status
 * @property {HTMLImageElement|null} image The loaded Image on success; null on fallback.
 */

/**
 * @typedef {Object} LoadSpriteOptions
 * @property {new () => HTMLImageElement} [ImageCtor] Image constructor to use.
 *   Defaults to the global `Image`. Injectable for testing.
 * @property {(fn: () => void, ms: number) => any} [setTimeout] Timer scheduler.
 *   Defaults to the global `setTimeout`. Injectable for testing.
 * @property {(handle: any) => void} [clearTimeout] Timer canceller.
 *   Defaults to the global `clearTimeout`. Injectable for testing.
 */

/**
 * Loads a sprite image with a timeout and fallback. Resolves (never rejects).
 *
 * Resolves `{ status: 'loaded', image }` when the image fires `load` before the
 * timeout; resolves `{ status: 'fallback', image: null }` on an `error` event or
 * when `timeoutMs` elapses first. The first terminal event wins; subsequent
 * events are ignored and the pending timer / image handlers are cleaned up.
 *
 * @param {string} [relativePath=DEFAULT_SPRITE_PATH] Relative path to the image.
 * @param {number} [timeoutMs=CONFIG.SPRITE_TIMEOUT_MS] Timeout in ms (default 5000).
 * @param {LoadSpriteOptions} [options] Injectable dependencies for testing.
 * @returns {Promise<SpriteResult>} Always resolves; never rejects.
 */
export function loadSprite(
  relativePath = DEFAULT_SPRITE_PATH,
  timeoutMs = CONFIG.SPRITE_TIMEOUT_MS,
  options = {},
) {
  const ImageCtor =
    options.ImageCtor ?? (typeof Image !== 'undefined' ? Image : undefined);
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;

  return new Promise((resolve) => {
    // No Image constructor available (e.g. a non-DOM environment without an
    // injected ctor): there is nothing to load, so fall back immediately.
    if (typeof ImageCtor !== 'function') {
      resolve({ status: 'fallback', image: null });
      return;
    }

    let settled = false;
    let timer = null;
    const image = new ImageCtor();

    const cleanup = () => {
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      // Detach handlers so a late event cannot touch a settled promise.
      image.onload = null;
      image.onerror = null;
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    image.onload = () => settle({ status: 'loaded', image });
    image.onerror = () => settle({ status: 'fallback', image: null });

    // Race the load against the timeout.
    timer = schedule(() => {
      // Cancel the pending image load by clearing its source.
      try {
        image.src = '';
      } catch {
        // Ignore environments where setting src throws.
      }
      settle({ status: 'fallback', image: null });
    }, timeoutMs);

    // Kick off the load. Setting src last ensures handlers are attached first.
    image.src = relativePath;
  });
}
