# PixelClash → 2D Particle Tower Defense Conversion Plan

## Vision
Convert the current 3D Three.js tower defense into a 2D particle-based game where:
- **Emitters** (towers) shoot streams of particles at enemies
- **Particles** have liquid-like physics - they flow, bounce, and knock enemies around
- **Enemies** come in waves and follow a path, getting pushed/slowed by particle impacts
- Inspired by FLERP, 9 Kings, and Bloons TD mechanics

---

## Phase 1: Remove Three.js, Add 2D Canvas Renderer

### 1.1 Create new 2D renderer (`src/renderer2d.ts`)
- Replace Three.js WebGLRenderer with HTML5 Canvas 2D context
- Implement basic drawing functions:
  - `drawGrid()` - render the game grid
  - `drawPath()` - highlight enemy path
  - `drawTower(tower)` - draw emitter at position
  - `drawEnemy(enemy)` - draw enemy with health bar
  - `drawParticle(particle)` - draw individual particle
  - `drawNexus()` - draw the thing to defend

### 1.2 Update coordinate system
- Remove Y axis (height) from all calculations
- Convert 3D world coordinates to 2D canvas pixels
- `worldToScreen(gridX, gridZ)` → `{x: pixelX, y: pixelY}`

### 1.3 Simplify input handling
- Replace raycaster with simple mouse-to-grid conversion
- `getGridPos(mouseX, mouseY)` → `{gridX, gridZ}`

### 1.4 Files to modify:
- `src/renderer.ts` → Replace entirely with `renderer2d.ts`
- `src/types.ts` → Simplify Vec3 to Vec2, remove mesh references
- `src/game.ts` → Remove Three.js mesh calls
- `index.html` → Remove Three.js CDN, add canvas element

---

## Phase 2: Particle System

### 2.1 New particle types (`src/particle.ts`)
```typescript
interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;          // velocity X
  vy: number;          // velocity Y
  mass: number;        // affects knockback
  damage: number;
  pierce: number;      // how many enemies it can hit before dying
  lifespan: number;    // time until auto-expire
  color: number;
  radius: number;
  type: 'water' | 'fire' | 'electric' | 'goo';
}
```

### 2.2 Particle physics
- Simple velocity-based movement: `x += vx * dt`, `y += vy * dt`
- Collision detection with enemies (circle-circle)
- On hit:
  - Apply damage
  - Apply knockback force to enemy: `enemy.vx += particle.vx * knockbackForce / enemy.mass`
  - Reduce pierce count, die if pierce <= 0
  - Optional: bounce off enemy with reduced velocity

### 2.3 Liquid-like behavior options
**Option A: Fake it with visuals**
- High particle count, small radius
- Trail rendering (draw last N positions)
- Particles spread slightly on emission

**Option B: Real physics (LiquidFun-style)**
- Particle-particle collisions
- Surface tension simulation
- More expensive but looks amazing

Recommend: Start with Option A, upgrade to B if performance allows

---

## Phase 3: Convert Towers to Emitters

### 3.1 Emitter types (replacing tower types)
| Emitter | Particle Type | Behavior |
|---------|---------------|----------|
| **Water Cannon** | water | High volume stream, pushes enemies back |
| **Flamethrower** | fire | Short range, DOT, no knockback |
| **Tesla Coil** | electric | Chain lightning, arcs between nearby enemies |
| **Goo Launcher** | goo | Sticky, slows enemies, puddles on ground |

### 3.2 Emitter properties
```typescript
interface Emitter {
  id: number;
  type: EmitterType;
  gridX: number;
  gridY: number;
  level: number;
  cooldown: number;
  // Particle spawn settings
  particlesPerShot: number;
  spreadAngle: number;      // cone of fire
  particleSpeed: number;
  particleDamage: number;
  particlePierce: number;
}
```

### 3.3 Targeting
- Emitters auto-target closest enemy in range
- Calculate angle to target
- Spawn particles in that direction with spread

---

## Phase 4: Enemy Knockback Physics

### 4.1 Add physics to enemies
```typescript
interface Enemy {
  // ... existing fields ...
  vx: number;           // knockback velocity X
  vy: number;           // knockback velocity Y
  mass: number;         // resistance to knockback
  friction: number;     // how fast knockback decays
}
```

### 4.2 Movement update
```typescript
function updateEnemy(enemy, dt) {
  // Apply knockback velocity
  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;

  // Decay knockback (friction)
  enemy.vx *= Math.pow(enemy.friction, dt);
  enemy.vy *= Math.pow(enemy.friction, dt);

  // Path following (reduced by knockback)
  if (Math.abs(enemy.vx) < 0.1 && Math.abs(enemy.vy) < 0.1) {
    // Resume normal path movement
    moveAlongPath(enemy, dt);
  }
}
```

### 4.3 Knockback balance
- Light enemies (fast type): High knockback, can be pushed off path
- Heavy enemies (tank type): Low knockback, barely moved
- Medium enemies: Balanced

---

## Phase 5: Visual Polish

### 5.1 Particle rendering
- Draw particles as circles with glow effect
- Color based on type (blue=water, orange=fire, yellow=electric, green=goo)
- Alpha fade based on remaining lifespan
- Optional: particle trails

### 5.2 Enemy rendering
- Simple colored shapes (circles or squares)
- Health bar above
- Flash on damage
- Knockback stretch effect (squash and stretch based on velocity)

### 5.3 Emitter rendering
- Base structure at grid position
- Barrel/nozzle pointing at current target
- Muzzle flash when firing

### 5.4 Effects
- Screen shake on big hits
- Particle splash on enemy death
- Path glow/pulse

---

## Phase 6: Wave System Enhancement

### 6.1 Keep existing wave structure
- Progressive difficulty
- Mix of enemy types
- Spawn timing

### 6.2 Add new enemy types
- **Splitter**: Splits into smaller enemies when killed
- **Phaser**: Periodically becomes immune to particles
- **Boss**: Large, slow, high HP, spawns minions

---

## Implementation Order

### Sprint 1: Core 2D Conversion (Days 1-2)
1. [ ] Create `renderer2d.ts` with Canvas API
2. [ ] Strip Three.js from all files
3. [ ] Get basic grid and path rendering
4. [ ] Verify towers and enemies draw correctly (as 2D shapes)

### Sprint 2: Particle System (Days 3-4)
1. [ ] Implement `Particle` interface and spawning
2. [ ] Basic particle movement and collision
3. [ ] Connect emitters to fire particles
4. [ ] Pierce and lifespan mechanics

### Sprint 3: Knockback Physics (Day 5)
1. [ ] Add velocity to enemies
2. [ ] Implement knockback on particle hit
3. [ ] Balance mass and friction values
4. [ ] Test with different enemy types

### Sprint 4: Polish & Balance (Days 6-7)
1. [ ] Visual effects (trails, glow, flash)
2. [ ] Sound effects (optional)
3. [ ] Balance emitter costs and damage
4. [ ] Playtest and iterate

---

## Technical Notes

### Performance Considerations
- Target: 60 FPS with 200+ particles on screen
- Use object pooling for particles (avoid GC)
- Spatial partitioning for collision detection (grid-based)
- Batch render calls where possible

### Libraries to Consider
- **None required** - pure Canvas 2D is sufficient
- Optional: **PixiJS** for WebGL 2D (if Canvas is too slow)
- Optional: **Matter.js** for physics (if we want real liquid sim)

### File Structure After Conversion
```
src/
├── main.ts           # Entry point, game loop
├── game.ts           # Core game logic (mostly unchanged)
├── renderer2d.ts     # NEW: 2D Canvas rendering
├── particle.ts       # NEW: Particle system
├── physics.ts        # NEW: Knockback and collision
├── emitter.ts        # Tower → Emitter conversion
├── config.ts         # Game balance (update for particles)
├── types.ts          # Updated interfaces
└── globals.d.ts      # Remove THREE declarations
```

---

## Success Criteria
- [ ] Game runs at 60 FPS with 100+ particles
- [ ] Enemies visibly react to particle impacts (knockback)
- [ ] Different emitter types feel distinct
- [ ] Players can push enemies off the path temporarily
- [ ] Wave progression feels challenging but fair

---

## References
- **FLERP**: Synergy system, chaining mechanics
- **9 Kings**: Grid placement, real-time combat
- **Bloons TD**: Pierce system, projectile variety, wave scaling
- **Creeper World**: Fluid-based enemies (future inspiration)
- **LiquidFun**: Real particle physics (stretch goal)
