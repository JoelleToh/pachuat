// src/pathfinding.js
//
// Enemy pursuit pathfinding for PacHuat (task 4.1). The maze is small and
// static, so a breadth-first search from the player's tile yields exact
// shortest-path tile distances to every reachable tile. A pursuing enemy then
// picks the open neighbor whose distance is smallest, breaking ties in the
// fixed order up/left/down/right and avoiding a needless reversal.
//
// This module is pure and DOM-free: it reads the Maze grid through the public
// Maze API (`openNeighbors`, `isWall`) and the shared direction/tile helpers,
// which makes it directly exercisable by the property test in task 4.2.
//
// Requirements covered:
//   3.2 move toward the player along open paths
//   3.3 choose the open direction whose resulting tile has the shortest
//       path distance to the player
//   3.4 break ties in the fixed order up, left, down, right
//   3.7 when the current direction points at a wall, pick an alternative open
//       direction using the same rules
//   3.8 reverse only when reversal is the sole open option

import {
  VECTORS,
  TIE_BREAK_ORDER,
  tileKey,
  opposite,
} from './constants.js';

/**
 * Computes shortest-path tile distances from the target tile to every tile
 * reachable from it, using breadth-first search over the maze's open graph
 * (Req 3.3). Distances are symmetric for an unweighted, undirected grid, so a
 * map built outward from the target gives, for any source tile, the length of
 * the shortest path between that tile and the target.
 *
 * The returned map is keyed by {@link tileKey} and omits unreachable tiles
 * (callers treat a missing key as "no known route to the target").
 *
 * @param {import('./maze.js').Maze} maze
 * @param {number} targetCol
 * @param {number} targetRow
 * @returns {Map<string, number>} tileKey -> distance in tiles from the target.
 */
export function bfsDistances(maze, targetCol, targetRow) {
  /** @type {Map<string, number>} */
  const distances = new Map();

  // A target sitting on a wall (or out of bounds) has no reachable graph.
  if (maze.isWall(targetCol, targetRow)) {
    return distances;
  }

  const startKey = tileKey(targetCol, targetRow);
  distances.set(startKey, 0);

  // Simple array-backed FIFO queue. The maze is small, so the head index
  // avoids repeated shift() cost without a dedicated deque.
  /** @type {{col:number,row:number}[]} */
  const queue = [{ col: targetCol, row: targetRow }];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = distances.get(tileKey(current.col, current.row));

    for (const neighbor of maze.openNeighbors(current.col, current.row)) {
      const key = tileKey(neighbor.col, neighbor.row);
      if (!distances.has(key)) {
        distances.set(key, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

/**
 * Collects the open directions available from a tile, in the fixed tie-break
 * order (up, left, down, right). A direction is "open" when stepping one tile
 * that way lands on a non-wall, in-bounds tile.
 *
 * @param {import('./maze.js').Maze} maze
 * @param {{col:number,row:number}} fromTile
 * @returns {{ dir: import('./constants.js').Direction, col: number, row: number }[]}
 */
function openDirections(maze, fromTile) {
  const result = [];
  for (const dir of TIE_BREAK_ORDER) {
    const { dcol, drow } = VECTORS[dir];
    const col = fromTile.col + dcol;
    const row = fromTile.row + drow;
    if (!maze.isWall(col, row)) {
      result.push({ dir, col, row });
    }
  }
  return result;
}

/**
 * Chooses the direction a pursuing enemy should move from `fromTile` toward the
 * player, using the distance map produced by {@link bfsDistances}.
 *
 * Selection rules:
 *   - Consider only open (non-wall) neighbors (Req 3.2, 3.7).
 *   - Prefer non-reversing options; the direction opposite `currentDir` is
 *     excluded unless it is the only open option (Req 3.8).
 *   - Among the candidates, pick the neighbor with the smallest shortest-path
 *     distance to the player (Req 3.3). A neighbor missing from the distance
 *     map is treated as unreachable (distance = Infinity).
 *   - Ties are resolved by the fixed order up, left, down, right (Req 3.4),
 *     which falls out of iterating candidates in {@link TIE_BREAK_ORDER}.
 *
 * Unreachable-player handling: when every candidate is unreachable (e.g. the
 * player sits behind walls or the distance map is empty), the first candidate
 * in tie-break order is returned rather than throwing. If the only open option
 * is a reversal, that reversal is returned. When the tile has no open neighbor
 * at all, the enemy keeps its current direction (or `null` if it had none).
 *
 * @param {import('./maze.js').Maze} maze
 * @param {{col:number,row:number}} fromTile
 * @param {Map<string, number>} distances tileKey -> distance (from bfsDistances)
 * @param {import('./constants.js').Direction|null} currentDir
 * @returns {import('./constants.js').Direction|null}
 */
export function chooseDirection(maze, fromTile, distances, currentDir) {
  const open = openDirections(maze, fromTile);

  // Dead end with no open neighbor: nothing to choose, keep current direction.
  if (open.length === 0) {
    return currentDir ?? null;
  }

  const reverse = opposite(currentDir);

  // Prefer non-reversing options; only fall back to a reversal when it is the
  // sole open option (Req 3.8).
  let candidates = open.filter((c) => c.dir !== reverse);
  if (candidates.length === 0) {
    candidates = open; // reversal is the only way out
  }

  const distanceOf = (c) => {
    const d = distances.get(tileKey(c.col, c.row));
    return d === undefined ? Infinity : d;
  };

  // `candidates` is already in up/left/down/right order, so a strict-less-than
  // comparison keeps the earliest direction on ties (Req 3.4). When the player
  // is unreachable every distance is Infinity and the first candidate wins,
  // which gives graceful, non-throwing behavior (Req 3.7/3.8 edge case).
  let best = candidates[0];
  let bestDist = distanceOf(best);
  for (let i = 1; i < candidates.length; i++) {
    const d = distanceOf(candidates[i]);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }

  return best.dir;
}
