// src/game.js
//
// The Game simulation hub for PacHuat (task 9.1: core structure). Game owns all
// simulation state (maze, player, four hamster enemies, score, lives, the
// Frightened sub-state, and the collision invulnerability window) and exposes a
// fixed-step `update` plus read-only getters the renderer consumes. It is pure
// and DOM-free so property-based and example tests can drive it directly.
//
// This task implements ONLY the core:
//   - Construction: a Maze, a Player at the maze's player spawn, four
//     HamsterEnemy instances at the maze's hamster spawns (Req 3.1), score 0,
//     lives START_LIVES (3, Req 5.1), Frightened inactive, invulnerability
//     window 0.
//   - The top-level mode machine 'loading' | 'ready' | 'playing' | 'won' |
//     'lost' with getters mode/score/lives/frightened/frightenedRemainingMs.
//   - start(): ready -> playing (Req 9.5).
//   - update(stepMs, intent): advance the player and all enemies one fixed
//     simulation step while playing; reject all movement input once the game
//     has ended ('won' or 'lost') (Req 5.6, 6.2).
//
// Pellet consumption / win (task 9.2) and power pellets + Frightened + enemy
// consumption (task 9.3) layer onto this same class. Task 9.4 adds collision
// detection, lives, the loss transition, and restart():
//   - After entities move and Frightened is resolved, a collision is registered
//     iff the player shares a tile with any enemy and the game is NOT Frightened
//     (Req 3.9); a non-debounced collision decreases lives by one and opens a
//     1500 ms invulnerability window that suppresses rapid repeats (Req 5.2,
//     5.3). Surviving (lives >= 1) returns all characters to spawn (Req 5.4);
//     losing the last life transitions to 'lost' and rejects input (Req 5.5,
//     5.6).
//   - restart(): rebuild a fresh session equal to a newly constructed game
//     (full pellets, score 0, lives 3, characters at spawn, mode 'ready')
//     (Req 6.4).
//
// update is deterministic: no clocks and no randomness, so identical inputs
// always produce identical state.
//
// Requirements: 1.1, 3.1, 3.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.2, 6.4, 9.5

import { CONFIG, sameTile } from './constants.js';
import { Maze, DEFAULT_MAZE_LAYOUT } from './maze.js';
import { Player } from './player.js';
import { HamsterEnemy } from './enemy.js';
import { clampScore } from './scoring.js';

/**
 * Top-level game modes (design "State Machine" + GameState data model).
 * @typedef {'loading'|'ready'|'playing'|'won'|'lost'} GameMode
 */

/**
 * The simulation hub. Holds all game state and advances it one fixed timestep
 * at a time in response to a movement intent.
 */
export class Game {
  /**
   * @param {ReadonlyArray<string>} [mazeLayout] The maze layout as an array of
   *   equal-length strings. Defaults to {@link DEFAULT_MAZE_LAYOUT}.
   * @param {typeof CONFIG} [config] Configuration constants. Defaults to the
   *   shared {@link CONFIG}; injectable so tests can vary tuning values.
   */
  constructor(mazeLayout = DEFAULT_MAZE_LAYOUT, config = CONFIG) {
    /**
     * Configuration constants (speeds, durations, point values, limits).
     * @type {typeof CONFIG}
     */
    this.config = config;

    /**
     * The maze grid model (walls, tunnels, spawns, and mutable pellet state).
     * @type {Maze}
     */
    this.maze = new Maze(mazeLayout);

    const playerSpawn = this.maze.playerSpawn;
    const hamsterSpawns = this.maze.hamsterSpawns;

    /**
     * The user-controlled avatar, positioned at the maze's player spawn
     * (Req 1.1).
     * @type {Player}
     */
    this.player = new Player(playerSpawn);

    /**
     * The four hamster enemies, one at each hamster spawn, each moving at the
     * per-game constant ENEMY_SPEED_TPS (Req 3.1, 3.2). The maze guarantees a
     * full set of hamster spawns; one enemy is created per spawn.
     * @type {HamsterEnemy[]}
     */
    this.enemies = hamsterSpawns.map(
      (spawn) => new HamsterEnemy(spawn, config.ENEMY_SPEED_TPS)
    );

    this._initState();

    /**
     * Current top-level mode. Construction completes initialization, so the
     * game is immediately `ready` and waits for a start input (Req 9.5). (There
     * is no asynchronous asset load in the simulation layer; the 'loading'
     * state exists for the bootstrap/renderer layer and is a valid mode value.)
     * @type {GameMode}
     */
    this.mode = 'ready';
  }

  /**
   * Initializes the mutable run state shared by construction and (later)
   * restart: score, lives, the Frightened sub-state, and the collision
   * invulnerability window. Kept separate so task 9.4's restart() can reuse it.
   * @returns {void}
   */
  _initState() {
    /**
     * Current score, clamped to [0, SCORE_MAX]. Starts at 0.
     * @type {number}
     */
    this._score = 0;

    /**
     * Remaining lives, in [0, START_LIVES]. Starts at START_LIVES (3, Req 5.1).
     * @type {number}
     */
    this._lives = this.config.START_LIVES;

    /**
     * The Frightened sub-state (orthogonal to mode, active only while playing).
     * Inactive at start with no remaining duration; activated for FRIGHTENED_MS
     * on power-pellet consumption and counted down each update (Req 4.1, 4.7).
     * @type {{ active: boolean, remainingMs: number }}
     */
    this._frightened = { active: false, remainingMs: 0 };

    /**
     * Remaining collision debounce / invulnerability window in milliseconds.
     * Zero means no active window. Populated by collision handling in task 9.4
     * (Req 5.3); initialized to 0 here.
     * @type {number}
     */
    this._invulnerableMs = 0;
  }

  // --- Query getters (read-only views for the renderer and tests) ----------

  /**
   * The current top-level mode.
   * @returns {GameMode}
   */
  get mode() {
    return this._mode;
  }

  /**
   * @param {GameMode} value
   */
  set mode(value) {
    this._mode = value;
  }

  /**
   * The current score (always an integer in [0, SCORE_MAX]).
   * @returns {number}
   */
  get score() {
    return this._score;
  }

  /**
   * The remaining lives (0..START_LIVES).
   * @returns {number}
   */
  get lives() {
    return this._lives;
  }

  /**
   * Whether the Frightened sub-state is currently active.
   * @returns {boolean}
   */
  get frightened() {
    return this._frightened.active;
  }

  /**
   * Remaining Frightened duration in milliseconds (0 when inactive).
   * @returns {number}
   */
  get frightenedRemainingMs() {
    return this._frightened.active ? this._frightened.remainingMs : 0;
  }

  // --- State transitions ---------------------------------------------------

  /**
   * Begins play: transitions from `ready` to `playing` (Req 9.5). Calling
   * start() in any other mode is a no-op, so it is safe to invoke idempotently
   * from the bootstrap layer.
   * @returns {void}
   */
  start() {
    if (this._mode === 'ready') {
      this._mode = 'playing';
    }
  }

  // --- Fixed-step simulation ----------------------------------------------

  /**
   * Advances the simulation by one fixed timestep.
   *
   * While `playing`, the player advances toward the current movement intent and
   * every enemy advances one step (pursuing the player, or fleeing while
   * Frightened). Once the game has ended (`won` or `lost`), all movement input
   * is rejected and no entity moves (Req 5.6, 6.2); likewise nothing advances
   * before the game has started (`loading`/`ready`).
   *
   * After movement and Frightened resolution, collisions are evaluated: a
   * life-losing collision (player overlapping an enemy outside Frightened and
   * outside the debounce window) decreases lives and either respawns everyone
   * (survived) or ends the session as `lost` (Req 3.9, 5.2-5.6).
   *
   * This method is deterministic (no clocks, no randomness).
   *
   * @param {number} stepMs Fixed timestep in milliseconds (e.g. 1000 / SIM_HZ).
   * @param {('up'|'down'|'left'|'right'|null)} [intent] The current requested
   *   movement direction from input, or null for no change.
   * @returns {void}
   */
  update(stepMs, intent) {
    // Only the `playing` mode simulates. Ended games (`won`/`lost`) reject all
    // movement input and advance nothing (Req 5.6, 6.2); `loading`/`ready`
    // likewise do not move entities until start() has run.
    if (this._mode !== 'playing') return;
    if (!(stepMs > 0)) return;

    // Advance the player toward the current intent (Req 1.3, 1.4, 1.5, 1.7).
    this.player.update(stepMs, this.maze, intent);

    // Pellet / power-pellet consumption and the win transition. Reading the
    // player's new tile, remove any collectible it now occupies and award the
    // exact point value removed through the clamped score path (Req 2.1, 2.2).
    // Both maze removers are idempotent and return 0 on an already-empty tile,
    // so previously eaten tiles leave the score unchanged (Req 2.7). Task 9.3
    // extends the power-pellet branch to also activate the Frightened state.
    const { col: pcol, row: prow } = this.player.tile;
    const pelletPoints = this.maze.removePellet(pcol, prow);
    if (pelletPoints > 0) {
      this._setScore(this._score + pelletPoints);
    }
    const powerPoints = this.maze.removePowerPellet(pcol, prow);
    if (powerPoints > 0) {
      this._setScore(this._score + powerPoints);
      // Activate (or refresh) the Frightened sub-state for the full duration.
      // Consuming a power pellet while already Frightened resets the remaining
      // time back to FRIGHTENED_MS rather than extending it (Req 4.1, 4.7).
      // Activating before enemies advance this step lets them flee immediately.
      this._frightened.active = true;
      this._frightened.remainingMs = this.config.FRIGHTENED_MS;
    }

    // Win transition: when the combined pellet + power-pellet count reaches 0,
    // the maze is cleared and the game is won (Req 6.1, 6.3). Switching to
    // 'won' stops all further movement and rejects input on subsequent updates
    // via the mode guard above (Req 6.2).
    if (this.maze.remainingCollectibles() === 0) {
      this._mode = 'won';
      return;
    }

    // Advance every enemy one fixed step, pursuing the player (or fleeing while
    // Frightened). The Frightened flag reflects the state active during this
    // step; a hamster already relocating (`returning`) ignores it and finishes
    // its trip to spawn before resuming pursuit (Req 4.8, handled in enemy.js).
    const playerTile = this.player.tile;
    const frightened = this._frightened.active;
    for (const enemy of this.enemies) {
      enemy.update(stepMs, this.maze, playerTile, frightened);
    }

    // Enemy consumption: while Frightened, any hamster now sharing the player's
    // tile is consumed — sent back toward its spawn (entering `returning` mode
    // in enemy.js, Req 4.4) and scoring POINTS.ENEMY (200) each (Req 2.3, 4.5).
    // The player's tile is already current (the player moved above); comparing
    // against each enemy's post-move tile resolves overlaps within this frame.
    if (frightened) {
      const playerPost = this.player.tile;
      for (const enemy of this.enemies) {
        if (enemy.mode !== 'returning' && sameTile(playerPost, enemy.tile)) {
          enemy.sendToSpawn();
          this._setScore(this._score + this.config.POINTS.ENEMY);
        }
      }
    }

    // Frightened timer countdown. Decrement by this step's duration; when it
    // reaches 0 the Frightened state ends (Req 4.6). Non-relocating hamsters
    // return to pursuit on their next update once the flag is false, while any
    // still `returning` finish relocating first (Req 4.8) — both handled by
    // enemy.js keying off the frightened flag and their own mode.
    if (this._frightened.active) {
      this._frightened.remainingMs -= stepMs;
      if (this._frightened.remainingMs <= 0) {
        this._frightened.active = false;
        this._frightened.remainingMs = 0;
      }
    }

    // Collision/lives/loss handling (task 9.4). Runs after entities have moved
    // and the Frightened state has been resolved for this step.
    //
    // Debounce countdown: an active invulnerability window suppresses a second
    // life-losing collision registered within COLLISION_DEBOUNCE_MS of a prior
    // one (Req 5.3). Decrementing here (once per update) advances the window at
    // the fixed step rate so the debounce measures real elapsed time.
    if (this._invulnerableMs > 0) {
      this._invulnerableMs -= stepMs;
      if (this._invulnerableMs < 0) this._invulnerableMs = 0;
    }

    // Collision registration: a collision event occurs iff the player shares a
    // tile with any enemy AND the game is not Frightened (Req 3.9). While
    // Frightened such an overlap consumes the enemy instead (handled above), so
    // collisions are only life-losing outside that state. A collision inside
    // the debounce window is ignored and does not decrease lives (Req 5.3).
    if (!frightened && this._invulnerableMs <= 0) {
      const playerTileNow = this.player.tile;
      const collided = this.enemies.some((enemy) =>
        sameTile(playerTileNow, enemy.tile)
      );
      if (collided) {
        // Register the collision: lose exactly one life (clamped at 0) and open
        // a fresh invulnerability window to debounce rapid repeats (Req 5.2).
        this._lives = Math.max(0, this._lives - 1);
        this._invulnerableMs = this.config.COLLISION_DEBOUNCE_MS;

        if (this._lives >= 1) {
          // Surviving the collision: return the player and every enemy to their
          // spawn tiles so play resumes from a known layout (Req 5.4).
          this._respawnCharacters();
        } else {
          // The last life is gone: end the session. Switching to 'lost' rejects
          // all further movement input via the mode guard above (Req 5.5, 5.6).
          this._mode = 'lost';
        }
      }
    }
  }

  /**
   * Returns the player and all enemies to their defined spawn tiles, clearing
   * each entity's movement state (direction, buffered turns, sub-tile
   * progress). Used after a survivable collision (Req 5.4) and by restart
   * (Req 6.4).
   * @returns {void}
   */
  _respawnCharacters() {
    this.player.resetTo(this.maze.playerSpawn);
    const hamsterSpawns = this.maze.hamsterSpawns;
    this.enemies.forEach((enemy, i) => enemy.resetTo(hamsterSpawns[i]));
  }

  /**
   * Resets the game to a fresh session, equivalent to a newly constructed Game
   * awaiting a start input (Req 6.4). The maze is restored to its full set of
   * pellets and power pellets, the run state (score 0, lives START_LIVES,
   * Frightened inactive, invulnerability window cleared) is reinitialized, all
   * characters are returned to their spawn tiles, and the mode returns to
   * `ready`. This mirrors the state-machine edges WON/LOST -> READY and makes
   * the resulting state equal to a fresh `new Game(...)` before start() (design
   * Property 21).
   * @returns {void}
   */
  restart() {
    this.maze.reset();
    this._initState();
    this._respawnCharacters();
    this._mode = 'ready';
  }

  /**
   * Sets the score, clamping it to the valid range (used by scoring logic in
   * tasks 9.2/9.3). Exposed as an internal helper so later tasks adjust the
   * score through a single clamped path.
   * @param {number} value
   * @returns {void}
   */
  _setScore(value) {
    this._score = clampScore(value);
  }
}
