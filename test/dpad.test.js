// @vitest-environment jsdom
//
// test/dpad.test.js
//
// Unit tests for the on-screen D-pad input behavior (task 11.5). src/dpad.js
// is a DOM/touch concern, so this file opts into the jsdom environment via the
// docblock above (the default Vitest environment for this project is a
// DOM-free Node environment per vitest.config.js).
//
// Covers:
//   - Each direction button tap sets the matching movement intent (Req 8.1),
//     verified end-to-end through an InputHandler wired to the DPad.
//   - A tap calls event.preventDefault to block scroll/zoom/text selection
//     (Req 8.3).
//
// Requirements: 8.1, 8.3

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DPad } from '../src/dpad.js';
import { InputHandler } from '../src/input.js';

/** The four directions the D-pad exposes. */
const DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * Builds a buttonsRoot element containing one button per direction, each
 * tagged with the data-direction attribute DPad.attach() looks up.
 * @returns {HTMLElement}
 */
function makeButtonsRoot() {
  const root = document.createElement('div');
  for (const direction of DIRECTIONS) {
    const button = document.createElement('button');
    button.setAttribute('data-direction', direction);
    root.appendChild(button);
  }
  return root;
}

/**
 * Resolves the button element for a given direction within a root.
 * @param {HTMLElement} root
 * @param {'up'|'down'|'left'|'right'} direction
 * @returns {HTMLElement}
 */
function buttonFor(root, direction) {
  return root.querySelector(`[data-direction="${direction}"]`);
}

describe('DPad input behavior', () => {
  /** @type {HTMLElement} */
  let buttonsRoot;

  beforeEach(() => {
    buttonsRoot = makeButtonsRoot();
    document.body.appendChild(buttonsRoot);
  });

  describe('each button sets the matching intent (Req 8.1)', () => {
    for (const direction of DIRECTIONS) {
      it(`a touchstart on the ${direction} button sets intent to '${direction}'`, () => {
        const input = new InputHandler();
        const dpad = new DPad(buttonsRoot, {
          onDirection: (dir) => input.setFromDpad(dir),
        });
        dpad.attach();

        expect(input.intent).toBeNull();

        buttonFor(buttonsRoot, direction).dispatchEvent(
          new Event('touchstart', { bubbles: true, cancelable: true }),
        );

        expect(input.intent).toBe(direction);

        dpad.detach();
      });

      it(`a click on the ${direction} button sets intent to '${direction}'`, () => {
        const input = new InputHandler();
        const dpad = new DPad(buttonsRoot, {
          onDirection: (dir) => input.setFromDpad(dir),
        });
        dpad.attach();

        buttonFor(buttonsRoot, direction).dispatchEvent(
          new Event('click', { bubbles: true, cancelable: true }),
        );

        expect(input.intent).toBe(direction);

        dpad.detach();
      });
    }

    it('wiring the DPad through InputHandler.attach() routes taps to intent', () => {
      const input = new InputHandler({ dpad: null });
      const dpad = new DPad(buttonsRoot, {});
      input.dpad = dpad;
      input.attach();

      buttonFor(buttonsRoot, 'right').dispatchEvent(
        new Event('click', { bubbles: true, cancelable: true }),
      );

      expect(input.intent).toBe('right');

      input.detach();
    });
  });

  describe('a tap blocks default browser behavior (Req 8.3)', () => {
    it('calls preventDefault on a touchstart tap', () => {
      const dpad = new DPad(buttonsRoot, { onDirection: () => {} });
      dpad.attach();

      const event = new Event('touchstart', { bubbles: true, cancelable: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      buttonFor(buttonsRoot, 'up').dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      dpad.detach();
    });

    it('calls preventDefault on a click tap', () => {
      const dpad = new DPad(buttonsRoot, { onDirection: () => {} });
      dpad.attach();

      const event = new Event('click', { bubbles: true, cancelable: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      buttonFor(buttonsRoot, 'down').dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      dpad.detach();
    });

    it('calls preventDefault on every direction button tap', () => {
      const dpad = new DPad(buttonsRoot, { onDirection: () => {} });
      dpad.attach();

      for (const direction of DIRECTIONS) {
        const event = new Event('touchstart', { bubbles: true, cancelable: true });
        const preventDefault = vi.spyOn(event, 'preventDefault');

        buttonFor(buttonsRoot, direction).dispatchEvent(event);

        expect(preventDefault).toHaveBeenCalledTimes(1);
      }

      dpad.detach();
    });
  });
});
