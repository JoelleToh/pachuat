// src/input.js
//
// InputHandler: translates D-pad button taps into a single current movement
// intent consumed by the simulation (game.update(stepMs, intent)).
//
// The on-screen D-pad is the sole input source (no swipe, no keyboard). On a
// button tap, dpad.js forwards the tapped direction here via setFromDpad,
// which sets the current intent. When several taps land within one frame, the
// most recently received tap wins and the earlier ones are discarded, since
// each call simply overwrites the stored intent (Req 1.6, 8.4).
//
// Covers task 11.1: `intent` getter, `setFromDpad(direction)` (most recent tap
// wins), and attach()/detach() wiring the D-pad as the sole input source.
//
// Requirements: 1.2, 1.6, 8.1, 8.4

/**
 * The valid movement directions a D-pad tap can map to.
 * @type {ReadonlyArray<'up'|'down'|'left'|'right'>}
 */
const DIRECTIONS = ['up', 'down', 'left', 'right'];

export class InputHandler {
  /**
   * @param {{ dpad?: import('./dpad.js').DPad|null }} [options]
   *   dpad is the on-screen D-pad controller (the sole input source). It may
   *   be null when the handler is constructed before the D-pad exists; in that
   *   case attach()/detach() are no-ops.
   */
  constructor({ dpad = null } = {}) {
    /**
     * The D-pad controller this handler wires on attach().
     * @type {import('./dpad.js').DPad|null}
     */
    this.dpad = dpad ?? null;

    /**
     * The current requested movement direction, or null when no tap has been
     * registered yet. Overwritten on every tap so the most recent tap wins.
     * @type {'up'|'down'|'left'|'right'|null}
     */
    this._intent = null;

    /**
     * Bound forwarder passed to the D-pad as its onDirection callback. Stored
     * so attach() and detach() reference the same function identity.
     * @type {(direction: 'up'|'down'|'left'|'right') => void}
     */
    this._onDirection = (direction) => this.setFromDpad(direction);
  }

  /**
   * The current movement intent: the direction of the most recent D-pad tap,
   * or null if none has been registered.
   * @returns {'up'|'down'|'left'|'right'|null}
   */
  get intent() {
    return this._intent;
  }

  /**
   * Sets the current intent from a D-pad button tap. Invoked by dpad.js on
   * each tap. The most recent call wins: multiple taps within a single frame
   * leave only the last-received direction (Req 1.6, 8.4). Invalid directions
   * are ignored so a stray value never corrupts the intent.
   * @param {'up'|'down'|'left'|'right'} direction
   */
  setFromDpad(direction) {
    if (DIRECTIONS.includes(direction)) {
      this._intent = direction;
    }
  }

  /**
   * Wires the D-pad as the sole input source: routes its taps into
   * setFromDpad and activates its DOM listeners. No-op when no D-pad was
   * supplied.
   */
  attach() {
    if (!this.dpad) return;
    this.dpad.onDirection = this._onDirection;
    this.dpad.attach();
  }

  /**
   * Unwires the D-pad, stopping tap forwarding and removing its DOM listeners.
   * No-op when no D-pad was supplied.
   */
  detach() {
    if (!this.dpad) return;
    this.dpad.detach();
  }
}
