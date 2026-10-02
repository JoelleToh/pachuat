// test/input.dpad.property.test.js
//
// Property-based test for D-pad tap intent mapping (task 11.4).
//
// Covers design Property 23 "D-pad taps set the intent to the tapped
// direction": for all D-pad button taps, the resulting movement intent equals
// the tapped button's direction (up, down, left, or right).
//
// Validates: Requirements 8.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { InputHandler } from '../src/input.js';
import { DPad } from '../src/dpad.js';

/** The four directions a D-pad button can represent. */
const DIRECTIONS = ['up', 'down', 'left', 'right'];

// A fast-check arbitrary that yields one of the four valid D-pad directions.
const direction = () => fc.constantFrom(...DIRECTIONS);

// Minimal fake DOM so a real DPad can be exercised without jsdom. The root
// resolves one element per direction via querySelector('[data-direction="X"]'),
// and each fake button records the handlers DPad.attach() wires so a tap can
// be simulated by invoking the touchstart handler with a preventDefault-able
// event.
function makeFakeDpadRoot() {
  const buttons = new Map();
  for (const dir of DIRECTIONS) {
    buttons.set(dir, {
      listeners: { touchstart: [], click: [] },
      addEventListener(type, handler) {
        (this.listeners[type] ??= []).push(handler);
      },
      removeEventListener(type, handler) {
        const list = this.listeners[type];
        if (!list) return;
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
      },
    });
  }
  return {
    buttons,
    querySelector(selector) {
      const match = /\[data-direction="(up|down|left|right)"\]/.exec(selector);
      return match ? buttons.get(match[1]) : null;
    },
  };
}

// Simulate a physical tap on a direction button by firing its touchstart
// handler with an event exposing a preventDefault spy.
function tap(root, dir) {
  const button = root.buttons.get(dir);
  const event = { preventDefault() {} };
  for (const handler of button.listeners.touchstart) handler(event);
}

// Feature: pacman-hamster, Property 23: D-pad taps set the intent to the tapped direction
describe('Property 23: D-pad taps set the intent to the tapped direction', () => {
  it('setFromDpad(direction) makes intent equal that direction', () => {
    fc.assert(
      fc.property(direction(), (dir) => {
        const handler = new InputHandler();
        handler.setFromDpad(dir);
        expect(handler.intent).toBe(dir);
      }),
      { numRuns: 100 },
    );
  });

  it('a DPad tap routed through onDirection sets the intent to the tapped direction', () => {
    fc.assert(
      fc.property(direction(), (dir) => {
        const root = makeFakeDpadRoot();
        const dpad = new DPad(root);
        const handler = new InputHandler({ dpad });
        // Wire the D-pad as the sole input source, then simulate a tap.
        handler.attach();
        tap(root, dir);
        expect(handler.intent).toBe(dir);
      }),
      { numRuns: 100 },
    );
  });

  it('the final intent always equals the direction of the last tap in a sequence', () => {
    fc.assert(
      fc.property(
        fc.array(direction(), { minLength: 1, maxLength: 20 }),
        (taps) => {
          const root = makeFakeDpadRoot();
          const dpad = new DPad(root);
          const handler = new InputHandler({ dpad });
          handler.attach();
          for (const dir of taps) tap(root, dir);
          expect(handler.intent).toBe(taps[taps.length - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
