// test/renderer.test.js
//
// Integration tests for the Renderer (task 15.2) driven by a MOCK Canvas 2D
// context. The renderer is a thin side-effect layer over the pure simulation,
// so we can capture every drawing call it makes against the injected context
// and assert the visible behavior without a real DOM or canvas:
//
//   - Req 3.5 : each hamster enemy is drawn via ctx.drawImage once per frame at
//               its tile top-left, when a sprite is present.
//   - Req 4.2 : the frightened appearance differs in color/treatment from the
//               pursuit appearance.
//   - Req 4.3 : near the end of Frightened the appearance blinks at
//               BLINK_TOGGLES_PER_SEC (4/sec), driven deterministically from
//               frightenedRemainingMs.
//   - Req 6.3, 7.4, 7.5 : on win/loss the HUD draws the end message and the
//               final score.
//   - Req 2.4, 7.2, 7.3 : the HUD reflects the current score and lives after
//               they change.
//
// The renderer draws exclusively through the injected ctx, so a plain Node mock
// context (no jsdom) is sufficient and preferable. We use a real Game and
// manipulate its state.

import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/renderer.js';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/constants.js';

// Palette constants mirrored from renderer.js (kept in sync by assertion).
const ENEMY_PURSUIT = '#ff7a1a';
const ENEMY_FRIGHTENED = '#2563eb';
const ENEMY_FRIGHTENED_BLINK = '#f8fafc';

/**
 * A mock Canvas 2D context that records every drawing call and property
 * assignment the renderer makes. fillStyle/globalAlpha are tracked both as the
 * current value and as an append-only history so order-sensitive assertions
 * (which color was active for which fill) are possible.
 */
function createMockCtx(width = 448, height = 496) {
  const calls = {
    drawImage: [],
    fillRect: [],
    fillText: [],
    arc: [],
    fill: 0,
    beginPath: 0,
    fillStyleHistory: [],
    globalAlphaHistory: [],
  };

  const ctx = {
    canvas: { width, height },
    // Writable state props the renderer sets.
    _fillStyle: '#000000',
    _globalAlpha: 1,
    textBaseline: 'alphabetic',
    textAlign: 'left',
    font: '10px sans-serif',

    get fillStyle() {
      return this._fillStyle;
    },
    set fillStyle(v) {
      this._fillStyle = v;
      calls.fillStyleHistory.push(v);
    },
    get globalAlpha() {
      return this._globalAlpha;
    },
    set globalAlpha(v) {
      this._globalAlpha = v;
      calls.globalAlphaHistory.push(v);
    },

    drawImage(image, dx, dy, dw, dh) {
      calls.drawImage.push({ image, dx, dy, dw, dh });
    },
    fillRect(x, y, w, h) {
      calls.fillRect.push({ x, y, w, h, fillStyle: this._fillStyle });
    },
    fillText(text, x, y) {
      calls.fillText.push({ text, x, y, fillStyle: this._fillStyle });
    },
    beginPath() {
      calls.beginPath++;
    },
    arc(cx, cy, r, a0, a1) {
      calls.arc.push({ cx, cy, r, a0, a1, fillStyle: this._fillStyle });
    },
    fill() {
      calls.fill++;
    },
  };

  return { ctx, calls };
}

/** The tile pixel size the renderer computes, mirrored for coordinate asserts. */
function tileSizeFor(game, width, height) {
  const maze = game.maze;
  return Math.max(
    1,
    Math.min(
      Math.floor(width / maze.width),
      Math.floor(height / maze.height),
    ),
  );
}

/** A started, playing game. */
function playingGame() {
  const game = new Game();
  game.start();
  expect(game.mode).toBe('playing');
  return game;
}

/** The concatenated HUD/message text drawn this frame. */
function allText(calls) {
  return calls.fillText.map((c) => c.text).join('\n');
}

describe('Renderer.drawImage per enemy at expected coordinates (Req 3.5)', () => {
  it('draws the sprite once per enemy at each enemy tile top-left', () => {
    const width = 448;
    const height = 496;
    const { ctx, calls } = createMockCtx(width, height);
    const sprite = { nodeName: 'IMG' }; // non-null stand-in for an HTMLImageElement
    const renderer = new Renderer(ctx, sprite);
    const game = playingGame();

    renderer.render(game);

    const tile = tileSizeFor(game, width, height);

    // One drawImage per hamster enemy (4 enemies, Req 3.1/3.5).
    expect(game.enemies.length).toBe(4);
    expect(calls.drawImage.length).toBe(game.enemies.length);

    // Each enemy drawn at its tile top-left, sized tile x tile, with the sprite.
    // Mirror the renderer's math: center = pixel*tile + tile/2; top-left =
    // center - tile/2 = pixel*tile.
    const expected = game.enemies.map((e) => {
      const px = e.pixel ? e.pixel.x : e.tile.col;
      const py = e.pixel ? e.pixel.y : e.tile.row;
      const cx = px * tile + tile / 2;
      const cy = py * tile + tile / 2;
      return { dx: cx - tile / 2, dy: cy - tile / 2 };
    });

    for (const exp of expected) {
      const match = calls.drawImage.find(
        (d) => d.dx === exp.dx && d.dy === exp.dy,
      );
      expect(match, `drawImage at (${exp.dx},${exp.dy})`).toBeTruthy();
      expect(match.image).toBe(sprite);
      expect(match.dw).toBe(tile);
      expect(match.dh).toBe(tile);
    }
  });

  it('falls back to drawing shapes (no drawImage) when the sprite is null', () => {
    const { ctx, calls } = createMockCtx();
    const renderer = new Renderer(ctx, null);
    const game = playingGame();

    renderer.render(game);

    expect(calls.drawImage.length).toBe(0);
    // Fallback still draws enemy shapes via arc/fill.
    expect(calls.arc.length).toBeGreaterThan(0);
  });
});

describe('frightened appearance differs from pursuit (Req 4.2)', () => {
  it('with a sprite: a frightened enemy adds a tint overlay fillRect not present in pursuit', () => {
    const sprite = { nodeName: 'IMG' };

    // Pursuit frame: not frightened.
    const pursuit = createMockCtx();
    new Renderer(pursuit.ctx, sprite).render(playingGame());

    // Frightened frame: activate frightened with time left but outside the
    // blink window so we compare the steady treatment.
    const frightenedGame = playingGame();
    frightenedGame._frightened.active = true;
    frightenedGame._frightened.remainingMs = CONFIG.FRIGHTENED_MS; // 8000 > 2000
    const fright = createMockCtx();
    new Renderer(fright.ctx, sprite).render(frightenedGame);

    // The frightened frame draws a translucent tint over each enemy cell using
    // the frightened color; the pursuit frame draws no such enemy-colored
    // overlay. Appearance therefore differs (Req 4.2).
    const pursuitTints = pursuit.calls.fillRect.filter(
      (r) => r.fillStyle === ENEMY_FRIGHTENED,
    );
    const frightTints = fright.calls.fillRect.filter(
      (r) => r.fillStyle === ENEMY_FRIGHTENED,
    );
    expect(pursuitTints.length).toBe(0);
    expect(frightTints.length).toBe(frightenedGame.enemies.length);

    // The overlay is translucent (globalAlpha < 1 was set at some point).
    expect(fright.calls.globalAlphaHistory.some((a) => a > 0 && a < 1)).toBe(
      true,
    );
  });

  it('without a sprite: the fallback enemy color differs between pursuit and frightened', () => {
    // Pursuit fill color.
    const pursuit = createMockCtx();
    new Renderer(pursuit.ctx, null).render(playingGame());

    const frightenedGame = playingGame();
    frightenedGame._frightened.active = true;
    frightenedGame._frightened.remainingMs = CONFIG.FRIGHTENED_MS;
    const fright = createMockCtx();
    new Renderer(fright.ctx, null).render(frightenedGame);

    // Enemy fill color was used in pursuit and the frightened color was not.
    expect(pursuit.calls.fillStyleHistory).toContain(ENEMY_PURSUIT);
    expect(pursuit.calls.fillStyleHistory).not.toContain(ENEMY_FRIGHTENED);
    // In frightened the enemy color is the distinct frightened color.
    expect(fright.calls.fillStyleHistory).toContain(ENEMY_FRIGHTENED);
  });
});

describe('frightened blink toggles at 4/sec near the end of Frightened (Req 4.3)', () => {
  // The blink window is the final FRIGHTENED_BLINK_MS (2000 ms); at
  // BLINK_TOGGLES_PER_SEC (4) the toggle period is 250 ms. The phase is a pure
  // function of frightenedRemainingMs:
  //   elapsedIntoWindow = FRIGHTENED_BLINK_MS - remainingMs
  //   toggleIndex       = floor(elapsedIntoWindow / 250)
  //   blinkOn (flash)   = toggleIndex is odd
  const BLINK_MS = CONFIG.FRIGHTENED_BLINK_MS; // 2000
  const PERIOD = 1000 / CONFIG.BLINK_TOGGLES_PER_SEC; // 250

  // Returns which overlay color the frightened sprite tint used for a given
  // remaining time (reads the enemy-colored fillRect added by the overlay).
  function overlayColorAt(remainingMs) {
    const sprite = { nodeName: 'IMG' };
    const game = playingGame();
    game._frightened.active = true;
    game._frightened.remainingMs = remainingMs;
    const { ctx, calls } = createMockCtx();
    new Renderer(ctx, sprite).render(game);

    const tint = calls.fillRect.find(
      (r) =>
        r.fillStyle === ENEMY_FRIGHTENED ||
        r.fillStyle === ENEMY_FRIGHTENED_BLINK,
    );
    expect(tint, `an overlay tint at remaining=${remainingMs}`).toBeTruthy();
    return tint.fillStyle;
  }

  it('alternates the appearance each 250 ms within the blink window', () => {
    // Sample the middle of each 250 ms toggle slot across the whole window so
    // the index math is unambiguous. remaining = BLINK_MS - (slot*250 + 125).
    const colorsBySlot = [];
    for (let slot = 0; slot < BLINK_MS / PERIOD; slot++) {
      const elapsed = slot * PERIOD + PERIOD / 2; // mid-slot
      const remaining = BLINK_MS - elapsed;
      colorsBySlot.push(overlayColorAt(remaining));
    }

    // 2000 / 250 = 8 toggle slots across the window.
    expect(colorsBySlot.length).toBe(8);

    // Even slots are the steady frightened color, odd slots are the flash.
    for (let slot = 0; slot < colorsBySlot.length; slot++) {
      const expected =
        slot % 2 === 1 ? ENEMY_FRIGHTENED_BLINK : ENEMY_FRIGHTENED;
      expect(colorsBySlot[slot], `slot ${slot}`).toBe(expected);
    }

    // Adjacent slots always differ => the appearance toggles at the slot rate
    // (4 toggles/sec), confirming the blink cadence (Req 4.3).
    for (let i = 1; i < colorsBySlot.length; i++) {
      expect(colorsBySlot[i]).not.toBe(colorsBySlot[i - 1]);
    }
  });

  it('does not blink earlier than the final 2 s (steady frightened before the window)', () => {
    // Well before the window (plenty of time remaining) the steady frightened
    // color is shown, never the flash.
    expect(overlayColorAt(CONFIG.FRIGHTENED_MS)).toBe(ENEMY_FRIGHTENED);
    expect(overlayColorAt(BLINK_MS + 1)).toBe(ENEMY_FRIGHTENED);
  });
});

describe('win / loss HUD message and final score (Req 6.3, 7.4, 7.5)', () => {
  it('draws the win message and the final score when won', () => {
    const { ctx, calls } = createMockCtx();
    const game = playingGame();
    game._setScore(1234);
    game.mode = 'won';

    new Renderer(ctx, null).render(game);

    const text = allText(calls);
    expect(text).toContain('You win!');
    expect(text).toContain('Final score: 1234');
    // The running Score HUD still reflects the (frozen) current score.
    expect(text).toContain('Score: 1234');
  });

  it('draws the loss message and the final score when lost', () => {
    const { ctx, calls } = createMockCtx();
    const game = playingGame();
    game._setScore(560);
    game.mode = 'lost';

    new Renderer(ctx, null).render(game);

    const text = allText(calls);
    expect(text).toContain('Game over');
    expect(text).toContain('Final score: 560');
  });

  it('does not draw an end banner while still playing', () => {
    const { ctx, calls } = createMockCtx();
    const game = playingGame();
    game._setScore(10);

    new Renderer(ctx, null).render(game);

    const text = allText(calls);
    expect(text).not.toContain('You win!');
    expect(text).not.toContain('Game over');
    expect(text).not.toContain('Final score');
  });
});

describe('HUD reflects current score and lives after changes (Req 2.4, 7.2, 7.3)', () => {
  it('shows the updated score across successive frames', () => {
    const renderer = new Renderer(createMockCtx().ctx, null);
    const game = playingGame();

    // Frame 1.
    let frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Score: 0');

    // Score changes.
    game._setScore(250);
    frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Score: 250');

    // Score changes again.
    game._setScore(999);
    frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Score: 999');

    // Keep the no-op renderer referenced so lint is happy.
    expect(renderer).toBeInstanceOf(Renderer);
  });

  it('shows the updated lives count after a life change', () => {
    const game = playingGame();
    expect(game.lives).toBe(CONFIG.START_LIVES); // 3

    let frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Lives: 3');

    // Lose a life.
    game._lives = 2;
    frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Lives: 2');

    // Lose another.
    game._lives = 1;
    frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Lives: 1');
  });

  it('always renders the score as a non-negative integer', () => {
    const game = playingGame();
    // Defensive: even if an out-of-range value is forced, display clamps it.
    game._score = -5;
    const frame = createMockCtx();
    new Renderer(frame.ctx, null).render(game);
    expect(allText(frame.calls)).toContain('Score: 0');
  });
});
