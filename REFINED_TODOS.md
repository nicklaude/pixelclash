# PixelClash Refined TODOs

## Phase 1: Core Mechanics (COMPLETED)
- [x] Basic tower placement
- [x] Wave spawning system
- [x] Projectile physics
- [x] Enemy pathfinding
- [x] Basic UI

## Phase 2: Polish & Feedback (COMPLETED)
- [x] Tower placement preview (ghost tower at hover position when placing)
- [x] Insufficient funds indicator (flash gold display when trying to place tower you can't afford)
- [x] Wave countdown timer display

## Phase 3: Gameplay Depth (COMPLETED)
- [x] Sniper tower (long range, slow fire rate, high damage single target)
  - Cost: 75 gold
  - Range: 10 cells (very long)
  - Damage: 45 (high single-target)
  - Fire rate: 0.8/sec (slow)
  - Strong knockback on hit
- [x] Splash tower (area damage)
  - Cost: 60 gold
  - Range: 5 cells
  - Base damage: 8 + 50% splash to nearby enemies
  - Splash radius: 60 pixels
  - Visual explosion effect on impact
- [x] Healer enemy type (heals nearby enemies)
  - Health: 30
  - Heals allies within 80 pixel radius
  - Heals 8 HP per second
  - Appears as circular with a cross symbol
  - Spawns in waves 9+
- [x] Invisible/cloaked enemy (harder to target, appears faded)
  - Health: 20
  - Speed: 150 (fast)
  - Appears semi-transparent with pulsing opacity
  - Diamond/stealth shape
  - Spawns in waves 6+
- [x] High score tracking (localStorage)
  - Saves best wave survived
  - Shows "Best: Wave X" in top HUD
  - "NEW HIGH SCORE!" notification on game over

## Phase 4: Future Enhancements (TODO)
- [ ] Upgrade paths for towers (branching upgrades)
- [ ] Boss abilities (special attacks)
- [ ] Sound effects and music
- [ ] Mobile touch controls
- [ ] Endless mode with scaling difficulty
- [ ] Tower selling confirmation
- [ ] Pause menu with restart option
