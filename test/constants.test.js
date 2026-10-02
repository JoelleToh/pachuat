// test/constants.test.js
//
// Unit tests for the shared constants and data-model primitives (task 2.2).
// Asserts direction vector/opposite correctness, the fixed tie-break order,
// the tileKey helper, and that every CONFIG value matches the exact spec
// values from design.md's "Configuration Constants" section.
//
// Requirements: 1.3, 3.4, 5.1

import { describe, it, expect } from 'vitest';
import {
  VECTORS,
  TIE_BREAK_ORDER,
  OPPOSITE,
  DIRECTIONS,
  CONFIG,
  opposite,
  isOpposite,
  vectorFor,
  step,
  tileKey,
  parseTileKey,
  sameTile,
} from '../src/constants.js';

describe('VECTORS', () => {
  it('maps each cardinal direction to its unit vector (row increases downward)', () => {
    expect(VECTORS.up).toEqual({ dcol: 0, drow: -1 });
    expect(VECTORS.down).toEqual({ dcol: 0, drow: 1 });
    expect(VECTORS.left).toEqual({ dcol: -1, drow: 0 });
    expect(VECTORS.right).toEqual({ dcol: 1, drow: 0 });
  });

  it('exposes exactly the four cardinal directions', () => {
    expect(Object.keys(VECTORS).sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(VECTORS)).toBe(true);
    expect(Object.isFrozen(VECTORS.up)).toBe(true);
  });

  it('vectorFor returns the matching vector and null for unknown input', () => {
    expect(vectorFor('up')).toEqual({ dcol: 0, drow: -1 });
    expect(vectorFor('right')).toEqual({ dcol: 1, drow: 0 });
    expect(vectorFor(null)).toBeNull();
    expect(vectorFor('diagonal')).toBeNull();
  });

  it('step applies one unit of a direction and leaves coords unchanged for null/unknown', () => {
    expect(step(3, 4, 'up')).toEqual({ col: 3, row: 3 });
    expect(step(3, 4, 'down')).toEqual({ col: 3, row: 5 });
    expect(step(3, 4, 'left')).toEqual({ col: 2, row: 4 });
    expect(step(3, 4, 'right')).toEqual({ col: 4, row: 4 });
    expect(step(3, 4, null)).toEqual({ col: 3, row: 4 });
    expect(step(3, 4, 'nope')).toEqual({ col: 3, row: 4 });
  });
});

describe('TIE_BREAK_ORDER', () => {
  it('is the fixed order up, left, down, right (Req 3.4)', () => {
    expect(TIE_BREAK_ORDER).toEqual(['up', 'left', 'down', 'right']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(TIE_BREAK_ORDER)).toBe(true);
  });
});

describe('DIRECTIONS', () => {
  it('lists the four movement directions', () => {
    expect(DIRECTIONS).toEqual(['up', 'down', 'left', 'right']);
    expect(Object.isFrozen(DIRECTIONS)).toBe(true);
  });
});

describe('opposite / isOpposite', () => {
  it('OPPOSITE pairs each direction with its reverse', () => {
    expect(OPPOSITE).toEqual({ up: 'down', down: 'up', left: 'right', right: 'left' });
  });

  it('opposite() returns the reverse direction', () => {
    expect(opposite('up')).toBe('down');
    expect(opposite('down')).toBe('up');
    expect(opposite('left')).toBe('right');
    expect(opposite('right')).toBe('left');
  });

  it('opposite() returns null for null/unknown directions', () => {
    expect(opposite(null)).toBeNull();
    expect(opposite(undefined)).toBeNull();
    expect(opposite('up-left')).toBeNull();
  });

  it('opposite() is an involution for valid directions', () => {
    for (const dir of DIRECTIONS) {
      expect(opposite(opposite(dir))).toBe(dir);
    }
  });

  it('isOpposite() is true only for genuine reversals', () => {
    expect(isOpposite('up', 'down')).toBe(true);
    expect(isOpposite('down', 'up')).toBe(true);
    expect(isOpposite('left', 'right')).toBe(true);
    expect(isOpposite('right', 'left')).toBe(true);
  });

  it('isOpposite() is false for same, perpendicular, or null directions', () => {
    expect(isOpposite('up', 'up')).toBe(false);
    expect(isOpposite('up', 'left')).toBe(false);
    expect(isOpposite('left', 'up')).toBe(false);
    expect(isOpposite(null, 'up')).toBe(false);
    expect(isOpposite('up', null)).toBe(false);
    expect(isOpposite(null, null)).toBe(false);
  });
});

describe('CONFIG', () => {
  it('holds the exact spec values from design.md', () => {
    expect(CONFIG.SIM_HZ).toBe(60);
    expect(CONFIG.PLAYER_SPEED_TPS).toBe(6);
    expect(CONFIG.ENEMY_SPEED_TPS).toBe(6);
    expect(CONFIG.FRIGHTENED_MS).toBe(8000);
    expect(CONFIG.FRIGHTENED_BLINK_MS).toBe(2000);
    expect(CONFIG.BLINK_TOGGLES_PER_SEC).toBe(4);
    expect(CONFIG.START_LIVES).toBe(3);
    expect(CONFIG.COLLISION_DEBOUNCE_MS).toBe(1500);
    expect(CONFIG.BUFFER_EXPIRE_MS).toBe(1000);
    expect(CONFIG.SPRITE_TIMEOUT_MS).toBe(5000);
    expect(CONFIG.DPAD_MIN_TOUCH_PX).toBe(44);
    expect(CONFIG.ORIENTATION_REFLOW_MS).toBe(500);
    expect(CONFIG.RESPONSIVE_MAX_WIDTH_PX).toBe(600);
    expect(CONFIG.SCORE_MAX).toBe(9_999_999);
  });

  it('holds the exact POINTS values', () => {
    expect(CONFIG.POINTS).toEqual({ PELLET: 10, POWER_PELLET: 50, ENEMY: 200 });
  });

  it('enemy speed sits within the designed [4,8] tiles/sec range (Req 3.2)', () => {
    expect(CONFIG.ENEMY_SPEED_TPS).toBeGreaterThanOrEqual(4);
    expect(CONFIG.ENEMY_SPEED_TPS).toBeLessThanOrEqual(8);
  });

  it('is deeply frozen (immutable)', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONFIG.POINTS)).toBe(true);
  });
});

describe('tile helpers', () => {
  it('tileKey builds a canonical "col,row" key', () => {
    expect(tileKey(0, 0)).toBe('0,0');
    expect(tileKey(3, 7)).toBe('3,7');
    expect(tileKey(12, 5)).toBe('12,5');
  });

  it('parseTileKey round-trips with tileKey', () => {
    expect(parseTileKey(tileKey(3, 7))).toEqual({ col: 3, row: 7 });
    expect(parseTileKey('12,5')).toEqual({ col: 12, row: 5 });
  });

  it('distinct tiles produce distinct keys (Set/Map safe)', () => {
    const keys = new Set([tileKey(1, 2), tileKey(2, 1), tileKey(1, 2)]);
    expect(keys.size).toBe(2);
  });

  it('sameTile compares cells by coordinates', () => {
    expect(sameTile({ col: 1, row: 2 }, { col: 1, row: 2 })).toBe(true);
    expect(sameTile({ col: 1, row: 2 }, { col: 2, row: 1 })).toBe(false);
    expect(sameTile(null, { col: 1, row: 2 })).toBe(false);
    expect(sameTile({ col: 1, row: 2 }, null)).toBe(false);
  });
});
