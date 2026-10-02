# Requirements Document

## Introduction

PacHuat is a mobile-only, touch-controlled maze arcade game inspired by classic Pac-Man, played in a phone browser in portrait orientation. The player navigates a maze, consuming pellets while avoiding enemy characters rendered as a custom hamster image (an orange fluffy hamster derived from the supplied photo, cropped and background-removed so the cardboard box is removed and only the hamster is shown on a transparent background). Power pellets temporarily let the player consume enemies for bonus points. The game tracks score and lives, and resolves to a win or lose condition. The game is a static web application (HTML, CSS, JavaScript, HTML5 Canvas) with no backend, so it deploys cleanly to GitHub Pages and can be shared via a public link. PacHuat is controlled exclusively by an on-screen directional D-pad operated by touch.

## Glossary

- **Game**: The complete PacHuat web application that manages state, rendering, input, and game rules.
- **Player_Character**: The user-controlled avatar that moves through the maze and consumes pellets.
- **Hamster_Enemy**: An enemy character, rendered using the supplied hamster image, that pursues the Player_Character.
- **Maze**: The grid-based playfield containing walls, paths, pellets, power pellets, and spawn locations.
- **Pellet**: A small collectible item; consuming all pellets is a win condition.
- **Power_Pellet**: A special collectible that places the Game into Frightened_State for a bounded duration.
- **Frightened_State**: A time-limited game state during which the Player_Character can consume Hamster_Enemy characters for points.
- **Score**: A non-negative integer representing accumulated points.
- **Lives**: A non-negative integer representing remaining Player_Character attempts.
- **Input_Handler**: The Game component that translates touch events (DPad button taps) into Player_Character movement intents.
- **DPad**: An on-screen set of four tappable directional buttons (up, down, left, right) rendered as part of the Game interface for touch devices.
- **Renderer**: The Game component that draws the Maze, Player_Character, Hamster_Enemy characters, and heads-up display onto an HTML5 Canvas.
- **HUD**: The heads-up display that shows Score, Lives, and game status messages.
- **Hamster_Sprite**: The image asset derived from the supplied hamster photo, cropped and background-removed so only the hamster is shown on a transparent background, used to draw each Hamster_Enemy.
- **GitHub_Pages**: The static hosting service used to publish the Game at a public URL.

## Requirements

### Requirement 1: Maze Navigation and Movement

**User Story:** As a player, I want to move my character through the maze with the on-screen directional buttons, so that I can collect pellets and avoid enemies.

#### Acceptance Criteria

1. WHEN the Game starts, THE Game SHALL render the Maze with walls, paths, pellets, power pellets, and the Player_Character at the designated spawn location.
2. WHEN the Input_Handler receives a DPad direction button tap, THE Game SHALL set the Player_Character requested movement direction to the corresponding direction.
3. WHILE the Player_Character requested movement direction points toward an open path, THE Game SHALL advance the Player_Character along that direction at a constant speed of 6 maze tiles per second, with movement updating every frame at a minimum rate of 30 frames per second.
4. IF the Player_Character requested movement direction points toward a wall, THEN THE Game SHALL keep the Player_Character stationary at the current tile position and retain the Player_Character prior movement direction unchanged.
5. WHEN the Player_Character reaches a horizontal tunnel exit on one edge of the Maze, THE Game SHALL reposition the Player_Character at the corresponding tunnel entrance on the opposite edge within the same frame, preserving the current movement direction and speed.
6. IF the Input_Handler receives two or more DPad direction button taps within the same frame, THEN THE Game SHALL set the Player_Character requested movement direction to the direction of the most recently received tap and discard the earlier taps.
7. WHEN the Input_Handler receives a DPad direction button tap while the Player_Character requested direction points toward a wall, THE Game SHALL buffer the newly requested direction and apply it as the Player_Character movement direction upon reaching the next tile where that direction points toward an open path, discarding the buffered direction if no such tile is reached within 1 second.

### Requirement 2: Pellet Collection and Scoring

**User Story:** As a player, I want to earn points by eating pellets, so that I can track my progress and aim for a high score.

#### Acceptance Criteria

1. WHEN the Player_Character occupies a tile containing an uneaten Pellet, THE Game SHALL remove the Pellet from the Maze and increase the Score by 10 points.
2. WHEN the Player_Character occupies a tile containing an uneaten Power_Pellet, THE Game SHALL remove the Power_Pellet from the Maze and increase the Score by 50 points.
3. WHEN a Hamster_Enemy is consumed during Frightened_State, THE Game SHALL increase the Score by 200 points per consumed Hamster_Enemy.
4. WHEN the Score changes, THE HUD SHALL update the displayed Score to the current value within 100 milliseconds.
5. THE HUD SHALL display the current Score as a non-negative integer in the range 0 to 9,999,999.
6. WHILE the Game is running, THE Game SHALL constrain the Score to be greater than or equal to 0 and less than or equal to 9,999,999.
7. IF the Player_Character occupies a tile whose Pellet or Power_Pellet has already been removed, THEN THE Game SHALL leave the Score unchanged.

### Requirement 3: Hamster Enemy Behavior

**User Story:** As a player, I want hamster enemies that chase me through the maze, so that the game is challenging.

#### Acceptance Criteria

1. WHEN the Game starts, THE Game SHALL place each of the 4 Hamster_Enemy instances at its designated spawn location in the Maze.
2. WHILE the Game is running and not in Frightened_State, THE Game SHALL move each Hamster_Enemy toward the Player_Character along open paths at a speed between 4 and 8 tiles per second that remains constant for the duration of the Game.
3. WHILE moving a Hamster_Enemy toward the Player_Character, THE Game SHALL select, from the available open directions, the direction whose resulting tile has the shortest path distance to the Player_Character's current tile.
4. IF two or more open directions yield an equal shortest path distance to the Player_Character, THEN THE Game SHALL select among the tied directions in the fixed priority order up, left, down, right.
5. THE Renderer SHALL draw each Hamster_Enemy using the Hamster_Sprite at that Hamster_Enemy's current tile position.
6. THE Hamster_Sprite SHALL display only the hamster with the cardboard box background removed on a transparent background.
7. IF a Hamster_Enemy's current movement direction points toward a wall, THEN THE Game SHALL select an alternative open direction for that Hamster_Enemy using the selection rules in criteria 3 and 4.
8. IF a Hamster_Enemy has no open direction available other than reversing its current direction, THEN THE Game SHALL reverse that Hamster_Enemy's movement direction.
9. WHEN the Player_Character and a Hamster_Enemy occupy the same tile AND the Game is not in Frightened_State, THE Game SHALL register a collision event.

### Requirement 4: Power Pellet and Frightened State

**User Story:** As a player, I want power pellets that let me eat the hamsters temporarily, so that I can turn the tables on my pursuers.

#### Acceptance Criteria

1. WHEN the Player_Character consumes a Power_Pellet, THE Game SHALL enter Frightened_State for a duration of 8 seconds measured from the moment of consumption.
2. WHILE the Game is in Frightened_State, THE Renderer SHALL display each Hamster_Enemy with a visually distinct frightened appearance that differs in color and sprite treatment from its pursuit appearance.
3. WHILE the Game is in Frightened_State and 2 seconds or less remain in the Frightened_State duration, THE Renderer SHALL toggle each Hamster_Enemy frightened appearance at a rate of 4 toggles per second to signal that the state is ending.
4. WHILE the Game is in Frightened_State and the Player_Character occupies the same tile as a Hamster_Enemy, THE Game SHALL remove that Hamster_Enemy from the Maze and return that Hamster_Enemy to its spawn location within 1 render frame.
5. WHEN a Hamster_Enemy is consumed during Frightened_State, THE Game SHALL increase the Score by 200 points per consumed Hamster_Enemy.
6. WHEN the Frightened_State duration elapses, THE Game SHALL return each Hamster_Enemy that is not currently relocating to pursuit behavior within 1 render frame.
7. WHEN the Player_Character consumes a Power_Pellet while already in Frightened_State, THE Game SHALL reset the Frightened_State duration to 8 seconds.
8. IF a Hamster_Enemy is still relocating to its spawn location when the Frightened_State duration elapses, THEN THE Game SHALL complete the relocation before returning that Hamster_Enemy to pursuit behavior.

### Requirement 5: Lives and Loss Condition

**User Story:** As a player, I want a limited number of lives, so that the game has stakes and a clear loss condition.

#### Acceptance Criteria

1. WHEN the Game starts, THE Game SHALL set Lives to 3.
2. WHEN a collision event is registered between the Player_Character and a Hamster_Enemy, THE Game SHALL decrease Lives by 1.
3. IF a second collision between the Player_Character and a Hamster_Enemy is registered within 1500 milliseconds after a prior Lives decrease, THEN THE Game SHALL ignore the second collision and SHALL NOT decrease Lives.
4. WHEN Lives decreases to a value of 1 or greater after a collision, THE Game SHALL reposition the Player_Character and each Hamster_Enemy to their defined spawn locations within 1000 milliseconds of the collision.
5. WHEN Lives decreases to 0 after a collision, THE Game SHALL end the current session within 1000 milliseconds and SHALL display a loss message on the HUD.
6. WHILE the current session is ended due to Lives reaching 0, THE Game SHALL reject all Player_Character movement inputs.
7. THE HUD SHALL display the current Lives as an integer in the range 0 to 3.

### Requirement 6: Win Condition

**User Story:** As a player, I want to win by clearing the maze, so that there is a goal to achieve.

#### Acceptance Criteria

1. WHEN the combined count of remaining Pellets and Power_Pellets in the Maze reaches 0, THE Game SHALL enter a win state within 100 milliseconds.
2. WHEN the Game enters a win state, THE Game SHALL stop all Player_Character and Hamster_Enemy movement and SHALL reject all movement inputs.
3. WHEN the Game enters a win state, THE Game SHALL display a win message and the final accumulated session Score on the HUD.
4. WHERE a restart control is provided, WHEN the player activates the restart control after a win or loss, THE Game SHALL reset the Maze to its full set of Pellets and Power_Pellets, set Score to 0, set Lives to 3, and return all characters to their starting positions within 500 milliseconds.

### Requirement 7: Rendering and Heads-Up Display

**User Story:** As a player, I want clear visuals and status information, so that I can understand the game state while playing.

#### Acceptance Criteria

1. WHILE a session is active, THE Renderer SHALL redraw the Maze, Player_Character, Hamster_Enemy characters, Pellets, and Power_Pellets onto an HTML5 Canvas at a minimum rate of 30 frames per second.
2. WHILE a session is active, THE HUD SHALL display the current Score as a non-negative integer and the current Lives as an integer between 0 and 3.
3. WHEN the Score or Lives changes, THE HUD SHALL update the displayed value within 100 milliseconds.
4. WHEN the Game enters a win state, THE HUD SHALL display a win message and SHALL stop updating Score and Lives.
5. WHEN the Game enters a loss state, THE HUD SHALL display a loss message and SHALL stop updating Score and Lives.
6. WHEN the browser viewport width is below 600 pixels, THE Renderer SHALL scale the Canvas so that its rendered width is less than or equal to the viewport width while preserving the Maze aspect ratio.
7. IF the Renderer fails to obtain an HTML5 Canvas rendering context, THEN THE Game SHALL display an error message on the page and SHALL NOT begin gameplay.

### Requirement 8: Input Controls

**User Story:** As a player, I want on-screen directional buttons, so that I can control my character on a touch screen.

#### Acceptance Criteria

1. WHEN the player taps a DPad direction button, THE Input_Handler SHALL set the Player_Character movement intent to that button's direction within 50 milliseconds.
2. WHILE a session is active, THE Game SHALL display the DPad as a persistent on-screen control.
3. WHEN the player taps a DPad button, THE Game SHALL prevent the default browser behavior, including scrolling, zoom, and text selection, for that touch event.
4. IF two or more DPad direction button taps occur within the same frame, THEN THE Input_Handler SHALL set the Player_Character movement intent to the direction of the most recently tapped button and discard the earlier taps.

### Requirement 9: Static Hosting and Asset Loading

**User Story:** As the game owner, I want to deploy the game as a static site to GitHub Pages, so that I can share a public link with friends.

#### Acceptance Criteria

1. THE Game SHALL consist solely of static assets (HTML, CSS, JavaScript, and image files) that require no server-side runtime or build step at request time.
2. WHEN the Game is loaded from a GitHub Pages URL, THE Game SHALL load the Hamster_Sprite using a path relative to the application root rather than an absolute path beginning with "/".
3. IF the Hamster_Sprite fails to load within 5 seconds of the load request, THEN THE Renderer SHALL draw each Hamster_Enemy using a fallback colored shape, AND THE Game SHALL continue to a playable state.
4. IF the Hamster_Sprite fails to load, THEN THE Game SHALL display a message on the HUD indicating that fallback graphics are in use, AND THE Game SHALL preserve all gameplay functionality.
5. WHEN all required assets have either loaded successfully or reached their fallback state, THE Game SHALL display a start prompt on the HUD within 1 second, AND THE Game SHALL NOT begin gameplay until the player provides a start input.
6. THE Game SHALL reference all asset paths relative to the application root so that the Game functions without error when served from a GitHub Pages project subpath (e.g., a URL path of the form /{repository-name}/).

### Requirement 10: Mobile Layout and Usability

**User Story:** As a mobile player, I want the game and controls sized for my phone screen, so that I can see the maze and reach the buttons comfortably.

#### Acceptance Criteria

1. WHILE the Game is displayed in portrait orientation on a viewport with a width of 600 pixels or less, THE Game SHALL arrange the Canvas and the DPad so that both fit within the viewport without requiring the page to scroll.
2. THE Game SHALL render each DPad touch target at a size of at least 44 by 44 CSS pixels.
3. THE Game SHALL define a viewport meta configuration that scales the Game to the device width and sets the initial scale to 1.0.
4. THE Game SHALL set the viewport meta configuration to disable user-initiated zoom so that pinch and double-tap zoom do not disrupt gameplay.
5. WHEN the device orientation changes between portrait and landscape, THE Game SHALL reposition and scale the Canvas and the DPad to fit within the current viewport within 500 milliseconds.
