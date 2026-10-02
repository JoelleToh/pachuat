// src/renderer.js
//
// The Renderer draws the PacHuat simulation state onto an HTML5 Canvas 2D
// context and surfaces the heads-up display (task 15.1). It is a thin,
// side-effect layer over the pure simulation: `render(game)` reads only the
// game's public getters (`mode`, `score`, `lives`, `frightened`,
// `frightenedRemainingMs`) and its `maze`/`player`/`enemies`, then issues
// drawing calls. It holds no simulation state of its own and never mutates the
// game.
//
// Responsibilities (design.md "renderer.js" interface + Req 7.*):
//   - Draw the maze walls, pellets, and power pellets (Req 7.1).
//   - Draw the player at its interpolated tile position (Req 7.1).
//   - Draw each hamster enemy at its tile position using the hamster sprite
//     via ctx.drawImage when a sprite is present (Req 3.5); when the sprite is
//     null (load failed/fallback) draw a distinct colored shape instead
//     (Req 9.3, 9.4).
//   - Render a visually distinct frightened appearance that differs in color
//     and treatment from the pursuit appearance (Req 4.2), and blink that
//     appearance at BLINK_TOGGLES_PER_SEC (4) toggles/sec during the final
//     FRIGHTENED_BLINK_MS (2000 ms) of Frightened state (Req 4.3). The blink
//     phase is derived deterministically from `frightenedRemainingMs` so a
//     mock context test can assert it without timers.
//   - Draw the HUD: the current score as a non-negative integer and lives in
//     0..3 (Req 7.2), and update within a frame of a change (Req 7.3, driven by
//     the loop calling render each frame).
//   - On a win or loss, draw the corresponding message and the final score, and
//     stop reflecting further score/lives changes once ended (Req 7.4, 7.5,
//     6.3). The simulation already freezes score/lives in `won`/`lost`, so the
//     renderer simply reads the frozen values.
//   - When the sprite failed to load, show a "fallback graphics in use" notice
//     on the HUD (Req 9.4).
//
// Rendering happens via the injected 2D context so a mock context can capture
// calls in the integration test (task 15.2). Canvas pixel sizing and D-pad
// placement are owned by layout.js (Req 7.6, 10.*); this module only reads the
// canvas's current width/height to compute a tile pixel size.
//
// Requirements: 3.5, 3.6, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.4

import { CONFIG } from './constants.js';

/** Visual palette for the maze, entities, and HUD. */
const COLORS = Object.freeze({
  BACKGROUND: '#000000',
  WALL: '#1e3a8a', // deep blue maze walls
  PELLET: '#ffd27f', // small warm dots
  POWER_PELLET: '#ffb3c1', // larger pink dots
  PLAYER: '#ffe14d', // yellow avatar
  ENEMY: '#ff7a1a', // orange hamster (fallback shape, pursuit)
  ENEMY_FRIGHTENED: '#2563eb', // blue "edible" frightened treatment (Req 4.2)
  ENEMY_FRIGHTENED_BLINK: '#f8fafc', // near-white flash during the blink window
  ENEMY_RETURNING: '#64748b', // muted gray while relocating to spawn
  HUD_TEXT: '#ffffff',
  MESSAGE_TEXT: '#ffe14d',
});

/**
 * Milliseconds per blink toggle during the Frightened end-of-state warning.
 * At BLINK_TOGGLES_PER_SEC toggles per second this is 1000 / 4 = 250 ms, so the
 * appearance flips every quarter second (Req 4.3).
 * @type {number}
 */
const BLINK_PERIOD_MS = 1000 / CONFIG.BLINK_TOGGLES_PER_SEC;

/**
 * The Renderer draws a Game's state onto a Canvas 2D context.
 */
export class Renderer {
  /**
   * @param {CanvasRenderingContext2D} ctx The 2D context to draw into. In tests
   *   this is a mock that records the calls made against it.
   * @param {HTMLImageElement|null} sprite The loaded hamster sprite, or null
   *   when the sprite failed to load (fallback mode). When null, enemies are
   *   drawn as colored shapes and the HUD shows a fallback notice (Req 9.3,
   *   9.4).
   */
  constructor(ctx, sprite = null) {
    /** @type {CanvasRenderingContext2D} */
    this.ctx = ctx;

    /** @type {HTMLImageElement|null} */
    this.sprite = sprite ?? null;

    /**
     * Whether the sprite failed to load. Derived once from the constructor
     * argument so the HUD can show a persistent "fallback graphics in use"
     * notice (Req 9.4).
     * @type {boolean}
     */
    this.spriteFallback = this.sprite == null;
  }

  /**
   * Draws one full frame of the game: background, maze, collectibles, player,
   * enemies, and the HUD. Reads only the game's public surface and never
   * mutates it. Called once per animation frame by the loop (Req 7.1), which is
   * also how HUD values stay current within 100 ms of a change (Req 7.3).
   *
   * @param {import('./game.js').Game} game The simulation to render.
   * @returns {void}
   */
  render(game) {
    const ctx = this.ctx;
    const maze = game.maze;

    const canvasWidth = this._canvasWidth();
    const canvasHeight = this._canvasHeight();

    // Tile pixel size derived from the canvas dimensions and maze size, so the
    // drawing scales with whatever pixel size layout.js assigned to the canvas
    // (Req 7.6). Use the smaller axis ratio so square tiles always fit.
    const tile = Math.max(
      1,
      Math.min(
        Math.floor(canvasWidth / maze.width),
        Math.floor(canvasHeight / maze.height),
      ),
    );

    // Clear to the background each frame before redrawing (Req 7.1).
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    this._drawMaze(ctx, maze, tile);
    this._drawCollectibles(ctx, maze, tile);
    this._drawPlayer(ctx, game.player, tile);
    this._drawEnemies(ctx, game, tile);
    this._drawHud(ctx, game, canvasWidth, canvasHeight);
    this._updateDomHud(game);
  }

  // --- Maze and collectibles ----------------------------------------------

  /**
   * Fills every wall tile as a rectangle (Req 7.1).
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./maze.js').Maze} maze
   * @param {number} tile Tile size in pixels.
   * @returns {void}
   */
  _drawMaze(ctx, maze, tile) {
    ctx.fillStyle = COLORS.WALL;
    for (let row = 0; row < maze.height; row++) {
      for (let col = 0; col < maze.width; col++) {
        if (maze.isWall(col, row)) {
          ctx.fillRect(col * tile, row * tile, tile, tile);
        }
      }
    }
  }

  /**
   * Draws remaining pellets (small dots) and power pellets (larger dots) at
   * their tile centers (Req 7.1).
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./maze.js').Maze} maze
   * @param {number} tile
   * @returns {void}
   */
  _drawCollectibles(ctx, maze, tile) {
    const pelletRadius = Math.max(1, tile * 0.12);
    const powerRadius = Math.max(2, tile * 0.3);

    for (let row = 0; row < maze.height; row++) {
      for (let col = 0; col < maze.width; col++) {
        const cx = col * tile + tile / 2;
        const cy = row * tile + tile / 2;
        if (maze.hasPellet(col, row)) {
          ctx.fillStyle = COLORS.PELLET;
          this._dot(ctx, cx, cy, pelletRadius);
        } else if (maze.hasPowerPellet(col, row)) {
          ctx.fillStyle = COLORS.POWER_PELLET;
          this._dot(ctx, cx, cy, powerRadius);
        }
      }
    }
  }

  // --- Player and enemies -------------------------------------------------

  /**
   * Draws the player as a filled circle at its interpolated position
   * (Req 7.1). The player uses `pixel` (in tile units) so motion renders
   * smoothly between tile centers.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./player.js').Player} player
   * @param {number} tile
   * @returns {void}
   */
  _drawPlayer(ctx, player, tile) {
    const { x, y } = this._entityPixel(player, tile);
    ctx.fillStyle = COLORS.PLAYER;
    this._dot(ctx, x, y, tile * 0.42);
  }

  /**
   * Draws every hamster enemy at its tile position (Req 3.5). When a sprite is
   * present each enemy is drawn with ctx.drawImage at its top-left pixel
   * (Req 3.5); otherwise a distinct colored shape is drawn (Req 9.3, 9.4).
   *
   * Appearance by state:
   *   - pursuit (chase): orange sprite / orange shape.
   *   - frightened: a visually distinct treatment that differs in color from
   *     pursuit (Req 4.2) — the sprite is tinted via a translucent overlay and
   *     the fallback shape switches to the frightened color. During the final
   *     FRIGHTENED_BLINK_MS the appearance blinks at BLINK_TOGGLES_PER_SEC
   *     (Req 4.3), computed deterministically from `frightenedRemainingMs`.
   *   - returning: a muted treatment while relocating to spawn.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./game.js').Game} game
   * @param {number} tile
   * @returns {void}
   */
  _drawEnemies(ctx, game, tile) {
    const frightened = game.frightened;
    const blinkOn = this._blinkOn(game.frightenedRemainingMs);

    for (const enemy of game.enemies) {
      const { x, y } = this._entityPixel(enemy, tile);
      const left = x - tile / 2;
      const top = y - tile / 2;

      // A frightened, non-returning enemy wears the frightened appearance; a
      // returning enemy keeps its own muted treatment regardless of state.
      const isFrightenedLook = frightened && enemy.mode !== 'returning';

      if (this.sprite != null) {
        // Sprite present: draw the hamster image at the enemy's tile position
        // (Req 3.5). The integration test asserts drawImage per enemy at these
        // coordinates.
        ctx.drawImage(this.sprite, left, top, tile, tile);

        // Overlay treatments change the appearance without hiding the sprite,
        // keeping pursuit and frightened visually distinct (Req 4.2) and the
        // blink visible near the end of Frightened (Req 4.3).
        if (isFrightenedLook) {
          const overlay = blinkOn
            ? COLORS.ENEMY_FRIGHTENED_BLINK
            : COLORS.ENEMY_FRIGHTENED;
          this._overlayTint(ctx, left, top, tile, overlay, blinkOn ? 0.55 : 0.5);
        } else if (enemy.mode === 'returning') {
          this._overlayTint(ctx, left, top, tile, COLORS.ENEMY_RETURNING, 0.4);
        }
      } else {
        // Fallback: a colored shape distinct from the sprite (Req 9.3, 9.4).
        let color = COLORS.ENEMY;
        if (isFrightenedLook) {
          color = blinkOn
            ? COLORS.ENEMY_FRIGHTENED_BLINK
            : COLORS.ENEMY_FRIGHTENED;
        } else if (enemy.mode === 'returning') {
          color = COLORS.ENEMY_RETURNING;
        }
        ctx.fillStyle = color;
        this._dot(ctx, x, y, tile * 0.42);
      }
    }
  }

  /**
   * Whether the frightened appearance is in its "on" (flashed) phase of the
   * blink cycle. Blinking only occurs during the final FRIGHTENED_BLINK_MS of
   * the Frightened duration; outside that window this returns false so the
   * steady frightened appearance is shown (Req 4.3).
   *
   * The phase is a pure function of the remaining duration: within the blink
   * window, elapsed-into-window = FRIGHTENED_BLINK_MS - remainingMs, and the
   * toggle index is floor(elapsed / BLINK_PERIOD_MS). Even indices are "off"
   * (steady frightened), odd indices are "on" (flash). This determinism lets
   * the integration test assert the toggle rate from `frightenedRemainingMs`
   * alone, with no timers.
   *
   * @param {number} remainingMs Remaining Frightened duration (0 when inactive).
   * @returns {boolean}
   */
  _blinkOn(remainingMs) {
    if (remainingMs <= 0) return false;
    if (remainingMs > CONFIG.FRIGHTENED_BLINK_MS) return false;
    const elapsedIntoWindow = CONFIG.FRIGHTENED_BLINK_MS - remainingMs;
    const toggleIndex = Math.floor(elapsedIntoWindow / BLINK_PERIOD_MS);
    return toggleIndex % 2 === 1;
  }

  // --- HUD ------------------------------------------------------------------

  /**
   * Draws the HUD onto the canvas: score (a non-negative integer) and lives
   * (0..3) (Req 7.2), a fallback-graphics notice when the sprite failed to load
   * (Req 9.4), and — on a win or loss — the end message plus the final score
   * (Req 6.3, 7.4, 7.5). Because the simulation freezes score/lives in the
   * ended modes, drawing the current values here naturally stops updating them
   * after the game ends.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./game.js').Game} game
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   * @returns {void}
   */
  _drawHud(ctx, game, canvasWidth, canvasHeight) {
    const score = this._displayScore(game.score);
    const lives = this._displayLives(game.lives);

    ctx.fillStyle = COLORS.HUD_TEXT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Score: ${score}`, 8, 8);

    ctx.textAlign = 'right';
    ctx.fillText(`Lives: ${lives}`, canvasWidth - 8, 8);

    // Fallback-graphics notice (Req 9.4): shown whenever the sprite is absent.
    if (this.spriteFallback) {
      ctx.textAlign = 'center';
      ctx.font = '12px sans-serif';
      ctx.fillText('fallback graphics in use', canvasWidth / 2, 8);
    }

    // End-of-game banner: win/loss message plus the final score (Req 6.3, 7.4,
    // 7.5). Centered over the playfield.
    if (game.mode === 'won' || game.mode === 'lost') {
      const message = game.mode === 'won' ? 'You win!' : 'Game over';
      ctx.fillStyle = COLORS.MESSAGE_TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '28px sans-serif';
      ctx.fillText(message, canvasWidth / 2, canvasHeight / 2 - 16);
      ctx.font = '18px sans-serif';
      ctx.fillText(
        `Final score: ${score}`,
        canvasWidth / 2,
        canvasHeight / 2 + 16,
      );
    }
  }

  /**
   * Mirrors the HUD values into the DOM elements (#score, #lives, #message) when
   * they are present, so the accessible, text-based HUD stays in sync with the
   * canvas (Req 7.2-7.5, 9.4). This is best-effort and guarded for DOM-free
   * (test) environments: when there is no `document` it is a no-op, keeping the
   * renderer testable with a mock 2D context.
   *
   * @param {import('./game.js').Game} game
   * @returns {void}
   */
  _updateDomHud(game) {
    if (typeof document === 'undefined' || document == null) return;

    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = String(this._displayScore(game.score));

    const livesEl = document.getElementById('lives');
    if (livesEl) livesEl.textContent = String(this._displayLives(game.lives));

    const messageEl = document.getElementById('message');
    if (messageEl) {
      const parts = [];
      if (game.mode === 'won') {
        parts.push(`You win! Final score: ${this._displayScore(game.score)}`);
      } else if (game.mode === 'lost') {
        parts.push(`Game over. Final score: ${this._displayScore(game.score)}`);
      }
      if (this.spriteFallback) {
        parts.push('fallback graphics in use');
      }
      messageEl.textContent = parts.join(' — ');
    }
  }

  // --- Small drawing + value helpers --------------------------------------

  /**
   * Clamps the score to a non-negative integer for display (Req 7.2). The
   * simulation already clamps to [0, SCORE_MAX]; this is a defensive guard so
   * the HUD never shows a negative or fractional value.
   * @param {number} score
   * @returns {number}
   */
  _displayScore(score) {
    const n = Math.trunc(Number(score));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Clamps lives into the displayed 0..3 integer range (Req 7.2).
   * @param {number} lives
   * @returns {number}
   */
  _displayLives(lives) {
    const n = Math.trunc(Number(lives));
    if (!Number.isFinite(n)) return 0;
    return Math.min(CONFIG.START_LIVES, Math.max(0, n));
  }

  /**
   * The entity's render position in canvas pixels, derived from its `pixel`
   * (tile-unit) field when available, else its logical `tile`. Returns the
   * center point of the entity.
   * @param {{pixel?:{x:number,y:number}, tile:{col:number,row:number}}} entity
   * @param {number} tile Tile size in pixels.
   * @returns {{x:number,y:number}}
   */
  _entityPixel(entity, tile) {
    const px = entity.pixel ? entity.pixel.x : entity.tile.col;
    const py = entity.pixel ? entity.pixel.y : entity.tile.row;
    return { x: px * tile + tile / 2, y: py * tile + tile / 2 };
  }

  /**
   * Draws a filled circle (dot) at a center point.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx
   * @param {number} cy
   * @param {number} radius
   * @returns {void}
   */
  _dot(ctx, cx, cy, radius) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draws a translucent tint over a sprite cell so a frightened/returning
   * enemy differs in color from its pursuit appearance without hiding the
   * sprite (Req 4.2). globalAlpha is saved and restored around the fill.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} left
   * @param {number} top
   * @param {number} size
   * @param {string} color
   * @param {number} alpha
   * @returns {void}
   */
  _overlayTint(ctx, left, top, size, color, alpha) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(left, top, size, size);
    ctx.globalAlpha = prevAlpha == null ? 1 : prevAlpha;
  }

  /**
   * Current canvas pixel width, with a sensible default when the context's
   * canvas is unavailable (e.g. a minimal mock without a `canvas` field).
   * @returns {number}
   */
  _canvasWidth() {
    const w = this.ctx && this.ctx.canvas ? this.ctx.canvas.width : undefined;
    return Number.isFinite(w) && w > 0 ? w : 448;
  }

  /**
   * Current canvas pixel height, with a sensible default when unavailable.
   * @returns {number}
   */
  _canvasHeight() {
    const h = this.ctx && this.ctx.canvas ? this.ctx.canvas.height : undefined;
    return Number.isFinite(h) && h > 0 ? h : 496;
  }
}
