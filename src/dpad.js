// src/dpad.js
//
// DPad: the persistent on-screen directional controller for touch devices.
//
// A thin DOM/touch concern that owns the four direction buttons (up, down,
// left, right) living inside a root element and forwards taps to a supplied
// onDirection callback (wired to InputHandler.setFromDpad in main.js).
//
// Covers task 11.2: construct from a buttonsRoot and { onDirection }, wire
// touchstart/click on each of the four buttons, call preventDefault on each
// tap to block scroll/zoom/text selection (Req 8.3), and invoke
// onDirection(direction) so the intent is set within 50 ms (Req 8.1). The
// D-pad is shown persistently while a session is active (Req 8.2); its touch
// target sizing is a CSS concern handled in styles.css.
//
// Requirements: 8.1, 8.2, 8.3

/**
 * The four directions a D-pad button can represent.
 * @type {ReadonlyArray<'up'|'down'|'left'|'right'>}
 */
const DIRECTIONS = ['up', 'down', 'left', 'right'];

export class DPad {
  /**
   * @param {Element} buttonsRoot - The DOM element containing the four
   *   direction buttons. Each button is identified by a `data-direction`
   *   attribute whose value is one of 'up', 'down', 'left', or 'right'.
   * @param {{ onDirection?: (direction: 'up'|'down'|'left'|'right') => void }} [options]
   *   onDirection is invoked with the tapped button's direction.
   */
  constructor(buttonsRoot, { onDirection } = {}) {
    /** @type {Element|null} */
    this.buttonsRoot = buttonsRoot ?? null;

    /**
     * Callback invoked with the tapped direction. Defaults to a no-op so a
     * missing handler never throws on tap.
     * @type {(direction: 'up'|'down'|'left'|'right') => void}
     */
    this.onDirection = typeof onDirection === 'function' ? onDirection : () => {};

    /**
     * Resolved button element -> direction, built during attach() so detach()
     * can remove the exact listeners it added.
     * @type {Array<{ el: Element, direction: 'up'|'down'|'left'|'right', handler: (event: Event) => void }>}
     */
    this._bindings = [];

    /** @type {boolean} */
    this._attached = false;
  }

  /**
   * Wires touchstart and click on each of the four direction buttons found in
   * buttonsRoot. On a tap the handler calls preventDefault (blocking scroll,
   * zoom, and text selection per Req 8.3) and then invokes
   * onDirection(direction) (Req 8.1). Idempotent: calling attach() while
   * already attached is a no-op.
   */
  attach() {
    if (this._attached || !this.buttonsRoot) return;

    for (const direction of DIRECTIONS) {
      const el = this.buttonsRoot.querySelector(`[data-direction="${direction}"]`);
      if (!el) continue;

      const handler = (event) => {
        // Block the default browser behavior for the tap: scrolling, pinch /
        // double-tap zoom, and text selection (Req 8.3).
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        this.onDirection(direction);
      };

      el.addEventListener('touchstart', handler, { passive: false });
      el.addEventListener('click', handler);
      this._bindings.push({ el, direction, handler });
    }

    this._attached = true;
  }

  /**
   * Removes every listener added by attach() and clears the bindings, so the
   * D-pad stops forwarding taps. Idempotent: safe to call when not attached.
   */
  detach() {
    for (const { el, handler } of this._bindings) {
      el.removeEventListener('touchstart', handler, { passive: false });
      el.removeEventListener('click', handler);
    }
    this._bindings = [];
    this._attached = false;
  }
}
