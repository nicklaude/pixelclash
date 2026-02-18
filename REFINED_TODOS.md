# PixelClash - Refined TODO List

## Completed Features

### Turret System
- [x] Turret inspection panel (stats display, range ring visualization)
- [x] Upgrade system with scaling costs
- [x] Sell functionality with refund value
- [x] Procedural turret evolution graphics (level indicator, barrel rotation)

### Enemy System
- [x] Procedural enemy visuals (unique sprites for grunt, fast, tank, shielded, splitter, boss)
- [x] Death explosion particles
- [x] DOT (fire) visual effects
- [x] Knockback physics

### Settings & UI
- [x] Auto-wave system with pause/play toggle
- [x] Number keys (1-4) for tower selection
- [x] Click to place/select towers
- [x] ESC to deselect
- [x] Top HUD (wave, health, gold, pause status)
- [x] Bottom HUD (tower buttons with costs)

### Map
- [x] Fixed spiral path (procedural gen was reverted)
- [x] Nexus with pulse animation
- [x] Grid visualization with path highlighting

---

## Phase 1: Quick Wins (Controls & Display) - COMPLETE

### Arrow Key Tower Cycling
- [x] Left arrow: cycle to previous tower type
- [x] Right arrow: cycle to next tower type
- [x] Should wrap around (water -> goo -> electric -> fire -> water)
- [x] Only select if player can afford the tower

### Scroll Wheel in Turret Bar
- [x] When mouse is over bottom HUD area, scroll wheel cycles tower types
- [x] Scroll up: next tower
- [x] Scroll down: previous tower
- [x] Same affordability check as arrow keys

### FPS/Entity Display Above Canvas
- [x] Move performance stats above the game canvas (in HTML)
- [x] Display: FPS, entity count (enemies + projectiles)
- [x] Update instructions div to include arrow key hints

---

## Phase 2: Polish & Feedback

### Visual Feedback
- [ ] Tower placement preview (ghost tower at hover position)
- [ ] Insufficient funds indicator (flash gold when trying to place)
- [ ] Wave countdown timer display

### Audio (Future)
- [ ] Sound effects for placement, shooting, death
- [ ] Background music

---

## Phase 3: Gameplay Depth (Future)

### Additional Towers
- [ ] Sniper tower (long range, slow, high damage)
- [ ] Splash tower (area damage)

### Enemy Variety
- [ ] Healer enemy type
- [ ] Invisible/cloaked enemy

### Meta Features
- [ ] High score tracking (localStorage)
- [ ] Multiple difficulty presets
- [ ] Custom game settings panel

---

## Technical Notes

### File Structure
- `src/scenes/GameScene.ts` - Main game logic, input handling
- `src/scenes/UIScene.ts` - HUD rendering, button interactions
- `src/config.ts` - Game constants, tower/enemy definitions
- `index.html` - Page structure, instructions text

### Key Functions for Phase 1
- `GameScene.onKeyDown()` - Add arrow key handlers
- `GameScene.setSelectedEmitterType()` - Tower selection logic
- `UIScene.createBottomHUD()` - Add scroll listener
- `index.html` - Add FPS display element above canvas
