// test/pathfinding.property.test.js
//
// Property-based test for enemy pursuit direction selection (task 4.2).
//
// Covers design Property 10 "Enemy direction selection minimizes distance with
// fixed tie-break and no needless reversal": for all mazes and enemy/player
// positions, chooseDirection returns a direction that
//   - leads to an open (non-wall) tile,
//   - prefers a non-reversing option, reversing only when reversal is the sole
//     open option,
//   - whose resulting tile has the minimum shortest-path distance to the player
//     among the candidate open neighbors, and
//   - resolves ties in the fixed order up, left, down, right.
//
// The expected direction is recomputed independently of the implementation
// (BFS distances from the player, filtered candidate list, min-with-first-wins)
// so the test checks behavior rather than mirroring the production code path.
//
// Validates: Requirements 3.2, 3.3, 3.4, 3.7, 3.8

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { bfsDistances, chooseDirection } from '../src/pathfinding.js';
import { Maze, DEFAULT_MAZE_LAYOUT } from '../src/maze.js';
import { TIE_BREAK_ORDER, VECTORS, opposite } from '../src/constants.js';

/**
 * Enumerate all open (non-wall, in-bounds) tiles of a maze.
 * @param {Maze} maze
 * @returns {{col:number,row:number}[]}
 */
function openTiles(maze) {
  const tiles = [];
  for (let row = 0; row < maze.height; row++) {
    for (let col = 0; col < maze.width; col++) {
      if (!maze.isWall(col, row)) tiles.push({ col, row });
    }
  }
  return tiles;
}

/**
 * Independently reproduce the open directions available from a tile, in the
 * fixed tie-break order up, left, down, right.
 * @param {Maze} maze
 * @param {{col:number,row:number}} from
 * @returns {{dir:string,col:number,row:number}[]}
 */
function openDirections(maze, from) {
  const result = [];
  for (const dir of TIE_BREAK_ORDER) {
    const { dcol, drow } = VECTORS[dir];
    const col = from.col + dcol;
    const row = from.row + drow;
    if (!maze.isWall(col, row)) result.push({ dir, col, row });
  }
  return result;
}

/** Distance to a tile from the player's BFS map; Infinity when unreachable. */
function distanceOf(distances, col, row) {
  const d = distances.get(`${col},${row}`);
  return d === undefined ? Infinity : d;
}

/**
 * Compute the direction the enemy *should* choose, independent of the
 * production implementation, following the Property 10 rules verbatim.
 * Returns `currentDir` for a dead end (no open neighbor).
 */
function expectedDirection(maze, from, distances, currentDir) {
  const open = openDirections(maze, from);
  if (open.length === 0) return currentDir ?? null;

  const reverse = opposite(currentDir);
  let candidates = open.filter((c) => c.dir !== reverse);
  if (candidates.length === 0) candidates = open; // reversal is the sole option

  // Minimum distance, earliest tie-break order wins (candidates already in
  // up/left/down/right order, strict-less-than keeps the first on ties).
  let best = candidates[0];
  let bestDist = distanceOf(distances, best.col, best.row);
  for (let i = 1; i < candidates.length; i++) {
    const d = distanceOf(distances, candidates[i].col, candidates[i].row);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return best.dir;
}

// A small, procedurally generated maze arbitrary. Rows are equal-length and the
// perimeter is walled so coordinates stay in-bounds; interior cells are a mix of
// walls (#) and pellet paths (.) so there is a non-trivial open graph to search.
const generatedMazeArb = fc
  .record({
    width: fc.integer({ min: 4, max: 10 }),
    height: fc.integer({ min: 4, max: 10 }),
  })
  .chain(({ width, height }) =>
    fc
      // One boolean per interior cell: true => wall, false => open path.
      .array(fc.boolean(), {
        minLength: (width - 2) * (height - 2),
        maxLength: (width - 2) * (height - 2),
      })
      .map((interior) => {
        const rows = [];
        let k = 0;
        for (let r = 0; r < height; r++) {
          let line = '';
          for (let c = 0; c < width; c++) {
            const edge = r === 0 || r === height - 1 || c === 0 || c === width - 1;
            line += edge ? '#' : interior[k++] ? '#' : '.';
          }
          rows.push(line);
        }
        return rows;
      }),
  )
  // Keep only layouts with at least two open tiles so enemy and player can
  // occupy distinct (or coincident) open positions.
  .map((rows) => new Maze(rows))
  .filter((maze) => openTiles(maze).length >= 2);

const defaultMazeArb = fc.constant(new Maze(DEFAULT_MAZE_LAYOUT));

const mazeArb = fc.oneof(generatedMazeArb, defaultMazeArb);

// Feature: pacman-hamster, Property 10: Enemy direction selection minimizes distance with fixed tie-break and no needless reversal
describe('Property 10: Enemy direction selection minimizes distance with fixed tie-break and no needless reversal', () => {
  it('chooses an open, minimum-distance direction with fixed tie-break and no needless reversal (Req 3.2, 3.3, 3.4, 3.7, 3.8)', () => {
    const scenarioArb = mazeArb.chain((maze) => {
      const open = openTiles(maze);
      return fc.record({
        maze: fc.constant(maze),
        enemy: fc.constantFrom(...open),
        player: fc.constantFrom(...open),
        currentDir: fc.constantFrom(null, 'up', 'down', 'left', 'right'),
      });
    });

    fc.assert(
      fc.property(scenarioArb, ({ maze, enemy, player, currentDir }) => {
        const distances = bfsDistances(maze, player.col, player.row);
        const chosen = chooseDirection(maze, enemy, distances, currentDir);

        const open = openDirections(maze, enemy);

        // Dead end: no open neighbor. The enemy keeps its current direction and
        // there is nothing further to assert about openness/distance.
        if (open.length === 0) {
          expect(chosen).toBe(currentDir ?? null);
          return;
        }

        // 1) The chosen direction must be one of the open directions (Req 3.2, 3.7).
        const openDirs = open.map((o) => o.dir);
        expect(openDirs).toContain(chosen);

        // Resulting tile for the chosen direction.
        const chosenCell = open.find((o) => o.dir === chosen);
        expect(maze.isWall(chosenCell.col, chosenCell.row)).toBe(false);

        // 2) Reversal is only taken when it is the sole open option (Req 3.8).
        const reverse = opposite(currentDir);
        const nonReversal = open.filter((o) => o.dir !== reverse);
        if (chosen === reverse) {
          expect(nonReversal.length).toBe(0);
        }

        // 3) The resulting-tile distance equals the minimum over the candidate
        //    set: non-reversal candidates when any exist, otherwise all open
        //    directions (the sole-reversal case) (Req 3.3).
        const candidates = nonReversal.length > 0 ? nonReversal : open;
        const candidateDistances = candidates.map((c) =>
          distanceOf(distances, c.col, c.row),
        );
        const minDist = Math.min(...candidateDistances);
        expect(distanceOf(distances, chosenCell.col, chosenCell.row)).toBe(minDist);

        // 4) Ties are broken in the fixed order up, left, down, right, i.e. the
        //    chosen direction is the earliest candidate achieving the minimum.
        const expected = expectedDirection(maze, enemy, distances, currentDir);
        expect(chosen).toBe(expected);

        // Cross-check the tie-break ordering directly: no candidate earlier in
        // TIE_BREAK_ORDER than `chosen` may also achieve the minimum distance.
        const minimalCandidates = candidates.filter(
          (c) => distanceOf(distances, c.col, c.row) === minDist,
        );
        const earliest = TIE_BREAK_ORDER.find((d) =>
          minimalCandidates.some((c) => c.dir === d),
        );
        expect(chosen).toBe(earliest);
      }),
      { numRuns: 100 },
    );
  });
});
