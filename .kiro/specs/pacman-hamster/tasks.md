# Implementation Plan: PacHuat

## Overview

This plan builds PacHuat incrementally as a static, mobile-only, touch-controlled Pac-Man variant: vanilla JavaScript ES modules, HTML5 Canvas, no backend, no request-time build step. Work proceeds from the DOM-free simulation core outward to the I/O layers (input/D-pad, layout, rendering, asset loading), then wires everything together in `main.js` and `index.html` for GitHub Pages deployment with relative asset paths.

Testing is test-driven: property-based tests (fast-check under Vitest) cover the 25 correctness properties of the pure simulation and layout-fit logic (one test per property, tagged `// Feature: pacman-hamster, Property {n}: {text}`, min 100 iterations), complemented by example/unit tests, integration/mock-canvas tests, and smoke/asset checks. Each task builds on the previous ones and ends with integration so no code is left orphaned.

Convention: optional test sub-tasks are marked with `*` and are not implemented by default. The hamster sprite asset is produced by a one-time manual image-editing step, flagged explicitly below.

## Tasks

- [x] 1. Set up project structure and dev tooling
  - Create the flat static layout: `index.html`, `styles.css`, `src/` for ES modules, `assets/` for images, `test/` for Vitest specs
  - Add `package.json` with dev-only dependencies: `vitest` and `fast-check`; add a `test` script (use `vitest --run` for single execution, not watch mode)
  - Add `vitest.config.js` configured for an ESM, DOM-free Node environment for simulation tests (jsdom only where mock-canvas/DOM tests need it)
  - Create a shared test tagging helper/convention note so every property test can carry `// Feature: pacman-hamster, Property {n}: {text}` and run with `{ numRuns: 100 }`
  - Confirm no bundler/transpiler is introduced (modules load directly via `<script type="module">`), keeping the site deployable as static assets
  - _Requirements: 9.1_

- [x] 2. Define shared constants and data-model primitives
  - [x] 2.1 Implement direction and tile primitives
    - Create `src/constants.js` exporting `VECTORS`, `TIE_BREAK_ORDER` (`['up','left','down','right']`), and the full `CONFIG` object (SIM_HZ, PLAYER_SPEED_TPS, ENEMY_SPEED_TPS, FRIGHTENED_MS, FRIGHTENED_BLINK_MS, BLINK_TOGGLES_PER_SEC, START_LIVES, COLLISION_DEBOUNCE_MS, BUFFER_EXPIRE_MS, SPRITE_TIMEOUT_MS, DPAD_MIN_TOUCH_PX, ORIENTATION_REFLOW_MS, RESPONSIVE_MAX_WIDTH_PX, POINTS, SCORE_MAX)
    - Export direction/tile helpers (e.g., `tileKey(col,row)`, direction opposite lookup) used across modules
    - _Requirements: 1.3, 3.2, 3.4, 4.1, 5.1, 5.3, 1.7, 9.3, 10.2, 10.5, 7.6_
  - [x] 2.2 Write unit tests for primitives
    - Assert vector/opposite correctness and that CONFIG constants hold the exact spec values
    - _Requirements: 1.3, 3.4, 5.1_

- [x] 3. Implement the Maze grid model
  - [x] 3.1 Implement `Maze` from a string-array layout
    - Create `src/maze.js` parsing `#`, space, `.`, `o`, `P`, `H`, `T` into cells (wall/pellet/powerPellet/tunnel) and spawn locations
    - Implement `width`, `height`, `isWall`, `isTunnelExit`, `tunnelPartner`, `hasPellet`, `hasPowerPellet`, `openNeighbors`
    - Implement `removePellet`/`removePowerPellet` returning points removed or 0, `remainingCollectibles()`, and `reset()` restoring the full pellet set
    - Author a concrete default maze layout string array with 1 player spawn, 4 hamster spawns, and horizontal tunnel edges
    - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.7, 6.1, 6.4_
  - [x] 3.2 Write property test for collectible consumption (Property 6)
    - **Property 6: Consuming a collectible removes it and adds its exact point value**
    - **Validates: Requirements 2.1, 2.2**
  - [x] 3.3 Write property test for idempotent empty-tile consumption (Property 7)
    - **Property 7: Consuming an already-empty tile is idempotent on score**
    - **Validates: Requirements 2.7**
  - [x] 3.4 Write unit tests for maze parsing and reset
    - Assert pellet/power-pellet counts, spawn locations, tunnel partners, and that `reset()` restores the full collectible set
    - _Requirements: 1.1, 1.5, 6.4_

- [x] 4. Implement pathfinding (BFS pursuit)
  - [x] 4.1 Implement BFS distances and direction selection
    - Create `src/pathfinding.js` with `bfsDistances(maze, targetCol, targetRow)` returning shortest tile distances to every reachable tile
    - Implement `chooseDirection(maze, fromTile, distances, currentDir)` choosing the open neighbor with minimum distance, breaking ties up/left/down/right, avoiding reversal unless it is the only open option, and handling the unreachable-player case gracefully (keep current/reverse rather than throw)
    - _Requirements: 3.2, 3.3, 3.4, 3.7, 3.8_
  - [x] 4.2 Write property test for enemy direction selection (Property 10)
    - **Property 10: Enemy direction selection minimizes distance with fixed tie-break and no needless reversal**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.7, 3.8**

- [x] 5. Implement scoring utilities
  - [x] 5.1 Implement score points and clamping
    - Create `src/scoring.js` exporting `POINTS` (PELLET 10, POWER_PELLET 50, ENEMY 200) and `clampScore(n)` bounding results to the inclusive range 0..9,999,999 as an integer
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 4.5_
  - [x] 5.2 Write property test for score bounds (Property 8)
    - **Property 8: Score stays within bounds**
    - **Validates: Requirements 2.5, 2.6**

- [x] 6. Implement the Player entity
  - [x] 6.1 Implement `Player` movement, buffering, and tunnel wrap
    - Create `src/player.js` with `tile`, `dir`, `requestedDir`, `bufferedDir`, `bufferAgeMs` and `update(stepMs, maze, intent)`
    - Advance toward the requested direction when open at constant `PLAYER_SPEED_TPS`; when it points at a wall, stay at the current tile and retain the prior direction
    - Buffer a newly requested direction and apply it at the first subsequent tile where it is open, expiring the buffer after 1000 ms
    - Wrap through horizontal tunnels preserving direction and speed; implement `resetTo(spawn)`
    - _Requirements: 1.3, 1.4, 1.5, 1.7_
  - [x] 6.2 Write property test for constant-speed movement (Property 1)
    - **Property 1: Movement along open paths is constant-speed**
    - **Validates: Requirements 1.3**
  - [x] 6.3 Write property test for wall blocking (Property 2)
    - **Property 2: A wall blocks movement and preserves prior direction**
    - **Validates: Requirements 1.4**
  - [x] 6.4 Write property test for tunnel wrap (Property 3)
    - **Property 3: Tunnel wrap preserves direction and speed**
    - **Validates: Requirements 1.5**
  - [x] 6.5 Write property test for buffered turns (Property 5)
    - **Property 5: Buffered turns apply at the first open tile and expire after one second**
    - **Validates: Requirements 1.7**

- [x] 7. Implement the Hamster enemy entity
  - [x] 7.1 Implement `HamsterEnemy` modes and movement
    - Create `src/enemy.js` with `tile`, `dir`, `mode` (`chase`|`frightened`|`returning`), constructed with a constant speed in [4,8]
    - Implement `update(stepMs, maze, playerTile, frightened)` using `pathfinding` for chase pursuit, honoring tunnel wrap and the reversal rules
    - Implement `sendToSpawn()` (begin relocating to spawn) and `resetTo(spawn)`
    - _Requirements: 3.2, 3.3, 3.4, 3.7, 3.8, 4.4, 4.8_

- [x] 8. Checkpoint - simulation primitives
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the Game simulation hub
  - [x] 9.1 Implement core game state, modes, and the fixed-step update
    - Create `src/game.js` constructing maze, player, 4 enemies at spawns, score 0, lives 3, frightened inactive, invulnerability window 0
    - Implement modes `loading`|`ready`|`playing`|`won`|`lost`, getters (`mode`, `score`, `lives`, `frightened`, `frightenedRemainingMs`), `start()` (ready → playing), and `update(stepMs, intent)` advancing player and enemies one fixed step
    - Reject all movement input while mode is `won` or `lost`
    - _Requirements: 1.1, 3.1, 5.1, 5.6, 6.2, 9.5_
  - [x] 9.2 Implement pellet consumption and win transition
    - On the player occupying a collectible tile, remove it and add exactly its point value (via `scoring`), leaving already-empty tiles unchanged
    - When combined remaining pellets + power pellets reaches 0, transition to `won` and stop movement/input
    - _Requirements: 2.1, 2.2, 2.7, 6.1, 6.2, 6.3_
  - [x] 9.3 Implement power pellet, Frightened state, and enemy consumption
    - On power-pellet consumption, set Frightened active for `FRIGHTENED_MS` (8000 ms); re-consumption resets the timer to full
    - While Frightened, player overlapping an enemy sends that enemy to spawn (returning) and adds 200 per consumed enemy
    - When the Frightened timer reaches 0, return non-relocating enemies to chase; let still-returning enemies finish relocating before resuming pursuit
    - _Requirements: 2.3, 4.1, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 9.4 Implement collisions, lives, loss, and restart
    - Register a collision iff player and an enemy share a tile and the game is not Frightened; on a non-debounced collision decrease lives by 1 and open a 1500 ms invulnerability window
    - On surviving collisions (lives >= 1) reposition player and all enemies to spawns; on lives reaching 0 transition to `lost` and reject movement input
    - Implement `restart()` producing a fresh session equal to a freshly started game (full pellets, score 0, lives 3, all characters at spawn)
    - _Requirements: 3.9, 5.2, 5.3, 5.4, 5.5, 5.6, 6.4_
  - [x] 9.5 Write property test for frightened consumption scoring (Property 9)
    - **Property 9: Frightened consumption scores 200 per enemy**
    - **Validates: Requirements 2.3, 4.5**
  - [x] 9.6 Write property test for collision registration (Property 11)
    - **Property 11: Collision is registered exactly when overlapping outside Frightened state**
    - **Validates: Requirements 3.9**
  - [x] 9.7 Write property test for power-pellet activation (Property 12)
    - **Property 12: A power pellet activates Frightened state for the full duration**
    - **Validates: Requirements 4.1, 4.7**
  - [x] 9.8 Write property test for frightened overlap sending enemy to spawn (Property 13)
    - **Property 13: Overlap during Frightened state sends the enemy to spawn**
    - **Validates: Requirements 4.4**
  - [x] 9.9 Write property test for frightened-timeout return to pursuit (Property 14)
    - **Property 14: Frightened timeout returns non-relocating enemies to pursuit**
    - **Validates: Requirements 4.6**
  - [x] 9.10 Write property test for non-fatal collision with debounce (Property 15)
    - **Property 15: A non-fatal collision decreases lives by exactly one, with debounce**
    - **Validates: Requirements 5.2, 5.3**
  - [x] 9.11 Write property test for surviving-collision respawn (Property 16)
    - **Property 16: Surviving a collision returns all characters to spawn**
    - **Validates: Requirements 5.4**
  - [x] 9.12 Write property test for losing the last life (Property 17)
    - **Property 17: Losing the last life ends the session**
    - **Validates: Requirements 5.5**
  - [x] 9.13 Write property test for lives range (Property 18)
    - **Property 18: Lives stay within range**
    - **Validates: Requirements 5.7**
  - [x] 9.14 Write property test for win on clearing collectibles (Property 19)
    - **Property 19: Clearing all collectibles wins the game**
    - **Validates: Requirements 6.1**
  - [x] 9.15 Write property test for ended games rejecting input (Property 20)
    - **Property 20: Ended games reject movement input**
    - **Validates: Requirements 5.6, 6.2**
  - [x] 9.16 Write property test for restart producing a fresh session (Property 21)
    - **Property 21: Restart yields a fresh session**
    - **Validates: Requirements 6.4**
  - [x] 9.17 Write unit tests for initialization
    - Assert player at spawn and expected pellet counts (1.1), 4 enemies at spawns (3.1), and start sets lives to 3 (5.1)
    - _Requirements: 1.1, 3.1, 5.1_

- [x] 10. Checkpoint - full simulation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement input and the on-screen D-pad
  - [x] 11.1 Implement `InputHandler` intent mapping
    - Create `src/input.js` with `intent` getter, `setFromDpad(direction)` where the most recent tap wins within a frame, and `attach()`/`detach()` wiring the D-pad as the sole input source
    - _Requirements: 1.2, 1.6, 8.1, 8.4_
  - [x] 11.2 Implement `DPad` DOM/touch controller
    - Create `src/dpad.js` with `DPad(buttonsRoot, { onDirection })`, wiring `touchstart`/`click` on each of the four buttons, calling `preventDefault` to block scroll/zoom/selection and invoking `onDirection(direction)`; implement `attach()`/`detach()`
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 11.3 Write property test for most-recent-tap-wins (Property 4)
    - **Property 4: Most recent direction tap wins within a frame**
    - **Validates: Requirements 1.6, 8.4**
  - [x] 11.4 Write property test for D-pad tap sets intent (Property 23)
    - **Property 23: D-pad taps set the intent to the tapped direction**
    - **Validates: Requirements 8.1**
  - [x] 11.5 Write unit tests for D-pad input behavior
    - Assert each button sets the matching intent (8.1) and that a tap calls `preventDefault` to block scroll/zoom/text selection (8.3)
    - _Requirements: 8.1, 8.3_

- [x] 12. Implement responsive layout
  - [x] 12.1 Implement `Layout` sizing and reflow
    - Create `src/layout.js` with `Layout(canvas, dpadRoot, maze)` and a pure `apply(viewportWidth, viewportHeight)` that computes a canvas render width <= viewport width (preserving maze aspect ratio) and positions the D-pad so canvas + D-pad fit the portrait viewport without page scroll, keeping each button touch target >= 44x44 CSS px
    - Implement a debounced `attach()`/`detach()` resize/orientationchange handler that reflows within 500 ms
    - Keep the fit computation pure/returnable so it can be property-tested independent of the DOM
    - _Requirements: 7.6, 10.1, 10.2, 10.5_
  - [x] 12.2 Write property test for aspect-ratio-preserving canvas scaling (Property 22)
    - **Property 22: Responsive canvas scaling preserves aspect ratio**
    - **Validates: Requirements 7.6**
  - [x] 12.3 Write property test for portrait fit with adequate touch targets (Property 24)
    - **Property 24: Responsive layout fits the viewport in portrait with adequate touch targets**
    - **Validates: Requirements 10.1, 10.2**

- [x] 13. Implement asset loading with fallback
  - [x] 13.1 Implement `loadSprite`
    - Create `src/assetLoader.js` with `loadSprite(relativePath, timeoutMs = 5000)` resolving `{ status: 'loaded', image }` on success and `{ status: 'fallback', image: null }` on error or timeout, never rejecting; use the relative path `./assets/hamster.png`
    - _Requirements: 9.2, 9.3, 9.4_
  - [x] 13.2 Write property test for fallback on load failure (Property 25)
    - **Property 25: Sprite load failures resolve to a playable fallback**
    - **Validates: Requirements 9.3**

- [x] 14. Produce the background-removed hamster sprite asset (MANUAL IMAGE-EDITING STEP)
  - **This is a one-time manual authoring task, not a coding task — flagged because it requires an image editor and cannot be completed by a coding agent.**
  - Start from `WhatsApp Image 2026-10-02 at 7.56.12 PM.jpeg` at the workspace root; crop to the hamster and remove the background (including the cardboard box) using an image editor or online background remover
  - Export a transparent-background PNG at `assets/hamster.png` (<= 128x128) and commit it to the repository
  - Until this asset exists, the game must still run via the colored-shape fallback path from task 13
  - _Requirements: 3.6_

- [x] 15. Implement the Renderer
  - [x] 15.1 Implement canvas drawing of maze, entities, and HUD
    - Create `src/renderer.js` with `Renderer(ctx, sprite)` and `render(game)` drawing maze, pellets, power pellets, player, and enemies at >= 30 FPS cadence, plus the HUD (score as a non-negative integer, lives 0..3)
    - Draw each enemy with the sprite at its tile position; use a distinct colored-shape fallback when `sprite` is null; render a frightened appearance that differs in color/treatment from pursuit, and blink at 4 toggles/sec during the final 2 s of Frightened state
    - Render win/loss messages and the final score, stopping score/lives updates once ended; show a "fallback graphics in use" notice when the sprite failed to load
    - _Requirements: 3.5, 3.6, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.4_
  - [x] 15.2 Write integration tests with a mock canvas context
    - Assert `drawImage` per enemy at expected coordinates (3.5); frightened appearance differs from pursuit (4.2); blink toggles at 4/sec near the end of Frightened (4.3); win/loss HUD messages and final score (6.3, 7.4, 7.5); HUD reflects current score/lives after changes (2.4, 7.2, 7.3)
    - _Requirements: 2.4, 3.5, 4.2, 4.3, 6.3, 7.2, 7.3, 7.4, 7.5_

- [x] 16. Build the static page shell (index.html + styles.css)
  - [x] 16.1 Author `index.html`
    - Reference `styles.css` and `src/main.js` (`<script type="module">`) with relative paths; include the canvas, HUD container, and the four D-pad direction buttons as static markup
    - Declare `<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">`
    - _Requirements: 8.2, 9.1, 9.6, 10.3, 10.4_
  - [x] 16.2 Author `styles.css`
    - Style the mobile-first portrait layout; size each D-pad button touch target to at least 44x44 CSS px; keep the D-pad a persistent on-screen control
    - _Requirements: 8.2, 10.2_
  - [x] 16.3 Write a test asserting the viewport meta configuration
    - Parse `index.html` and assert the viewport meta contains `width=device-width`, `initial-scale=1.0`, and `user-scalable=no`
    - _Requirements: 10.3, 10.4_

- [x] 17. Wire everything together in main.js
  - [x] 17.1 Implement the bootstrap and game loop
    - Create `src/main.js` obtaining the canvas 2D context; on a null context, render a plain-DOM error message and do not start the loop or simulation
    - Kick off `loadSprite`, construct `Game`, `InputHandler`, `DPad`, `Layout`, and `Renderer`; on resolution show the start prompt and a fallback notice if applicable, gating gameplay on a start input
    - Run a fixed-timestep loop with `requestAnimationFrame` and an accumulator (SIM_HZ) calling `game.update(STEP, intent)` zero or more times, then one `renderer.render(game)` per frame; perform the initial layout and attach resize/orientation handling
    - _Requirements: 7.1, 7.7, 9.5_
  - [x] 17.2 Write integration tests for loop and bootstrap
    - Assert the loop renders each frame and sustains the simulation step rate (7.1), and that a null canvas context shows an error and does not start (7.7)
    - _Requirements: 7.1, 7.7_
  - [x] 17.3 Write mobile-layout integration tests
    - In a simulated portrait viewport <= 600 px, assert the canvas and D-pad fit without page scroll (10.1), each D-pad button computes to >= 44x44 CSS px (10.2), and an `orientationchange`/`resize` reflows within 500 ms (7.6, 10.5)
    - _Requirements: 7.6, 10.1, 10.2, 10.5_

- [x] 18. Smoke and asset checks for static hosting
  - [x] 18.1 Write smoke/asset tests
    - Assert `assets/hamster.png` exists and is a transparent-background PNG (3.6); the repo contains only static assets with no server runtime or request-time build (9.1); and asset paths are relative (`./...`) rather than root-absolute in both the sprite loader and `index.html` (9.2, 9.6)
    - _Requirements: 3.6, 9.1, 9.2, 9.6_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and are not implemented by default; implement them for full correctness coverage and a faster feedback loop.
- Task 14 is a one-time manual image-editing step (not a coding task) and is flagged accordingly; the game remains playable without it via the colored-shape fallback.
- Property-based tests use fast-check under Vitest, one test per property, each tagged `// Feature: pacman-hamster, Property {n}: {text}` and run with `{ numRuns: 100 }`.
- Each task references the specific requirement sub-clauses it satisfies for traceability; property-test tasks reference their design property number.
- Checkpoints provide incremental validation at natural boundaries (primitives, full simulation, and final integration).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "5.1", "11.1", "11.2", "13.1", "16.1", "16.2"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.1", "5.2", "6.1", "11.3", "11.4", "11.5", "12.1", "13.2", "16.3", "18.1"] },
    { "id": 3, "tasks": ["4.2", "6.2", "6.3", "6.4", "6.5", "7.1", "12.2", "12.3"] },
    { "id": 4, "tasks": ["9.1"] },
    { "id": 5, "tasks": ["9.2", "9.3", "9.4", "9.17"] },
    { "id": 6, "tasks": ["9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11", "9.12", "9.13", "9.14", "9.15", "9.16", "15.1"] },
    { "id": 7, "tasks": ["15.2", "17.1"] },
    { "id": 8, "tasks": ["17.2", "17.3"] }
  ]
}
```
