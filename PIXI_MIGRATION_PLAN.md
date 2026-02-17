# PixiJS v8 Migration Plan

This plan outlines converting PixelClash from Phaser 3.85 to PixiJS v8 for better visual control and particle performance.

## Why PixiJS?

- **Direct WebGL control** - better visual effects, custom shaders
- **ParticleContainer** - 100k+ particles at 60fps (vs Phaser's ~500)
- **Smaller bundle** - PixiJS ~180KB vs Phaser ~1MB
- **Graphics API** - more control for pixelated/juicy effects
- **No physics overhead** - we implement our own simple physics anyway

## What We Keep

These files are solid and mostly transfer directly:
- `config.ts` - all constants, wave generation, path definitions
- `types.ts` - all TypeScript interfaces (minor updates)

## Migration Phases

### Phase 1: Core Setup (Day 1)

**1.1 Install Dependencies**
```bash
npm uninstall phaser
npm install pixi.js@^8
```

**1.2 New Entry Point (`src/main.ts`)**
```typescript
import { Application } from 'pixi.js';
import { Game } from './Game';

const app = new Application();

async function init() {
  await app.init({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: 0x1a1a2e,
    roundPixels: true,
    antialias: false, // crisp pixels
    resolution: window.devicePixelRatio || 1,
  });

  document.getElementById('game-container')!.appendChild(app.canvas);

  const game = new Game(app);
  app.ticker.add((ticker) => game.update(ticker.deltaMS / 1000));
}

init();
```

**1.3 Main Game Class (`src/Game.ts`)**
```typescript
import { Application, Container } from 'pixi.js';

export class Game {
  app: Application;
  stage: Container;

  // Layers (z-ordering)
  gridLayer: Container;
  puddleLayer: Container;
  emitterLayer: Container;
  enemyLayer: Container;
  projectileLayer: Container;
  uiLayer: Container;

  constructor(app: Application) {
    this.app = app;
    this.stage = app.stage;

    // Add layers in order
    this.gridLayer = new Container();
    this.puddleLayer = new Container();
    // ... etc
    this.stage.addChild(this.gridLayer, this.puddleLayer, ...);
  }

  update(dt: number) {
    // Main game loop
  }
}
```

---

### Phase 2: Graphics Classes (Day 1-2)

**2.1 Grid Drawing**
```typescript
import { Graphics, Container } from 'pixi.js';

export class GridRenderer {
  container: Container;

  constructor() {
    this.container = new Container();
  }

  draw() {
    const g = new Graphics();

    // v8 API: shape THEN style
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        const isPath = pathCells.has(`${x},${y}`);
        const color = isPath ? 0x3d3328 :
          ((x + y) % 2 === 0) ? 0x2a3a2a : 0x253525;

        g.rect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2)
          .fill(color);
      }
    }

    this.container.addChild(g);
  }
}
```

**2.2 Enemy Class (`src/objects/Enemy.ts`)**
```typescript
import { Container, Graphics } from 'pixi.js';
import { EnemyData, EnemyType, Vec2 } from '../types';

export class Enemy extends Container {
  data_: EnemyData;
  graphics: Graphics;
  healthBar: Graphics;
  worldPath: Vec2[];
  velocity: Vec2 = { x: 0, y: 0 };

  constructor(x: number, y: number, id: number, type: EnemyType, worldPath: Vec2[]) {
    super();
    this.position.set(x, y);
    this.worldPath = worldPath;

    // Initialize data (same as before)
    this.data_ = { ... };

    this.graphics = new Graphics();
    this.healthBar = new Graphics();
    this.addChild(this.graphics, this.healthBar);

    this.draw();
  }

  draw() {
    const g = this.graphics;
    g.clear();

    const def = ENEMY_DEFS[this.data_.type];
    const s = def.size;
    const color = this.data_.flashTimer > 0 ? 0xffffff : def.color;

    // Pixelated enemy shapes (v8 graphics API)
    if (this.data_.type === 'grunt') {
      g.rect(-s, -s, s * 2, s * 2).fill(color);
      // Corner spikes
      g.rect(-s - 3, -s - 3, 4, 4).fill(darkenColor(color));
      // ... etc
    }
    // ... other enemy types
  }

  update(dt: number): boolean {
    // Same physics logic, but using this.velocity instead of Phaser body
    // Apply friction
    this.velocity.x *= Math.pow(this.data_.friction, dt * 60);
    this.velocity.y *= Math.pow(this.data_.friction, dt * 60);

    // Update position
    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;

    // Path following logic (same as current)
    // ...

    return this.data_.health > 0;
  }

  applyKnockback(fx: number, fy: number) {
    this.velocity.x += fx / this.data_.mass;
    this.velocity.y += fy / this.data_.mass;
  }
}
```

**2.3 Emitter/Tower Class (`src/objects/Emitter.ts`)**
```typescript
import { Container, Graphics, Text } from 'pixi.js';

export class Emitter extends Container {
  data_: EmitterData;
  base: Graphics;
  barrel: Graphics;
  rangeCircle: Graphics;
  levelText: Text;

  constructor(gridX: number, gridY: number, id: number, type: EmitterType) {
    super();
    this.position.set(
      gridX * CELL_SIZE + CELL_SIZE / 2,
      gridY * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT
    );

    this.base = new Graphics();
    this.barrel = new Graphics();
    this.rangeCircle = new Graphics();
    this.levelText = new Text({ text: '', style: { fontSize: 10 } });

    this.addChild(this.rangeCircle, this.base, this.barrel, this.levelText);
    this.draw();
  }

  draw() {
    const def = EMITTER_DEFS[this.data_.type];
    const size = CELL_SIZE * 0.7;

    // Base
    this.base.clear();
    this.base.rect(-size/2, -size/2, size, size).fill(def.color);

    // Barrel (rotates separately)
    this.barrel.clear();
    this.barrel.rect(0, -4, size * 0.6, 8).fill(darkenColor(def.color));
    this.barrel.rotation = this.data_.angle;
  }
}
```

---

### Phase 3: Particle System (Day 2)

**3.1 Object Pool**
```typescript
export class ObjectPool<T extends PooledObject> {
  private pool: T[] = [];
  private factory: () => T;

  constructor(factory: () => T, initialSize: number = 100) {
    this.factory = factory;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  get(): T {
    return this.pool.pop() || this.factory();
  }

  release(obj: T) {
    obj.reset();
    this.pool.push(obj);
  }
}
```

**3.2 Projectile with Pooling**
```typescript
import { Sprite, Texture, Container } from 'pixi.js';

export class Projectile extends Sprite implements PooledObject {
  data_: ParticleData | null = null;
  velocity: Vec2 = { x: 0, y: 0 };
  trail: Vec2[] = [];
  trailGraphics: Graphics;

  constructor() {
    // Create pixel texture once and reuse
    super(Texture.WHITE);
    this.anchor.set(0.5);
    this.trailGraphics = new Graphics();
    this.addChild(this.trailGraphics);
  }

  init(x: number, y: number, vx: number, vy: number, data: ParticleData) {
    this.position.set(x, y);
    this.velocity = { x: vx, y: vy };
    this.data_ = data;
    this.trail = [];
    this.visible = true;

    // Set color via tint
    this.tint = EMITTER_DEFS[data.type].color;
    this.width = 6;
    this.height = 6;
  }

  reset() {
    this.visible = false;
    this.data_ = null;
    this.trail = [];
    this.trailGraphics.clear();
  }

  update(dt: number): boolean {
    // Update position
    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;

    // Trail
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > PARTICLE_TRAIL_LENGTH) {
      this.trail.pop();
    }

    // Draw trail
    this.trailGraphics.clear();
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = 1 - i / this.trail.length;
      const size = 4 * (1 - i / this.trail.length);
      this.trailGraphics
        .rect(
          this.trail[i].x - this.x - size/2,
          this.trail[i].y - this.y - size/2,
          size, size
        )
        .fill({ color: this.tint, alpha: alpha * 0.5 });
    }

    // Lifespan
    this.data_!.lifespan -= dt;
    return this.data_!.lifespan > 0 && this.data_!.pierce > 0;
  }
}
```

**3.3 ParticleContainer for High Volume**
```typescript
import { ParticleContainer, Sprite, Texture } from 'pixi.js';

// For VERY high particle counts (goo puddle effects, etc.)
export class EffectParticleSystem {
  container: ParticleContainer;
  particles: EffectParticle[] = [];
  pool: EffectParticle[] = [];
  texture: Texture;

  constructor(maxParticles: number = 10000) {
    this.container = new ParticleContainer(maxParticles, {
      vertices: true,
      position: true,
      tint: true,
      uvs: false,
    });

    // Create a simple square texture
    this.texture = Texture.WHITE;
  }

  spawn(x: number, y: number, color: number, count: number = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.pop() || this.createParticle();
      p.init(x, y, color);
      this.particles.push(p);
      this.container.addChild(p.sprite);
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p.update(dt)) {
        this.container.removeChild(p.sprite);
        this.pool.push(p);
        this.particles.splice(i, 1);
      }
    }
  }
}
```

---

### Phase 4: Collision System (Day 2-3)

**4.1 Simple AABB/Circle Collision**
```typescript
export class CollisionSystem {
  checkCircleCollision(
    ax: number, ay: number, ar: number,
    bx: number, by: number, br: number
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < ar + br;
  }

  checkProjectileEnemyCollisions(
    projectiles: Projectile[],
    enemies: Enemy[]
  ): Collision[] {
    const collisions: Collision[] = [];

    for (const proj of projectiles) {
      if (!proj.visible || !proj.data_) continue;

      for (const enemy of enemies) {
        if (!enemy.visible) continue;
        if (proj.data_.hitEnemies.has(enemy.data_.id)) continue;

        const def = ENEMY_DEFS[enemy.data_.type];
        if (this.checkCircleCollision(
          proj.x, proj.y, 6,
          enemy.x, enemy.y, def.size
        )) {
          collisions.push({ projectile: proj, enemy });
        }
      }
    }

    return collisions;
  }
}
```

---

### Phase 5: UI Layer (Day 3)

**5.1 Top Bar**
```typescript
import { Container, Graphics, Text } from 'pixi.js';

export class TopBar extends Container {
  background: Graphics;
  goldText: Text;
  healthText: Text;
  waveText: Text;

  constructor() {
    super();

    this.background = new Graphics();
    this.background.rect(0, 0, CANVAS_WIDTH, UI_TOP_HEIGHT).fill(0x16161e);

    this.goldText = new Text({ text: '💰 200', style: { fill: '#ffcc00' } });
    this.healthText = new Text({ text: '❤️ 20', style: { fill: '#ff4444' } });
    this.waveText = new Text({ text: 'Wave 1', style: { fill: '#ffffff' } });

    this.addChild(this.background, this.goldText, this.healthText, this.waveText);
  }

  update(gold: number, health: number, wave: number) {
    this.goldText.text = `💰 ${gold}`;
    this.healthText.text = `❤️ ${health}`;
    this.waveText.text = `Wave ${wave}`;
  }
}
```

**5.2 Bottom Bar (Tower Selection)**
```typescript
export class BottomBar extends Container {
  buttons: TowerButton[] = [];

  constructor(onSelect: (type: EmitterType) => void) {
    super();
    this.y = GAME_HEIGHT + UI_TOP_HEIGHT;

    const types: EmitterType[] = ['water', 'fire', 'electric', 'goo'];
    types.forEach((type, i) => {
      const btn = new TowerButton(type, i * 100 + 20, 20);
      btn.on('pointerdown', () => onSelect(type));
      this.buttons.push(btn);
      this.addChild(btn);
    });
  }
}
```

---

### Phase 6: Input Handling (Day 3)

```typescript
export class InputHandler {
  game: Game;
  hoverCell: { x: number; y: number } | null = null;

  constructor(game: Game) {
    this.game = game;

    // Make stage interactive
    game.app.stage.eventMode = 'static';
    game.app.stage.hitArea = game.app.screen;

    game.app.stage.on('pointermove', this.onPointerMove.bind(this));
    game.app.stage.on('pointerdown', this.onPointerDown.bind(this));

    // Keyboard
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  onPointerMove(e: FederatedPointerEvent) {
    this.hoverCell = this.pixelToGrid(e.globalX, e.globalY);
  }

  onPointerDown(e: FederatedPointerEvent) {
    const grid = this.pixelToGrid(e.globalX, e.globalY);
    if (!grid) return;

    if (this.game.selectedEmitterType) {
      this.game.placeEmitter(grid.x, grid.y);
    } else {
      const emitter = this.game.getEmitterAt(grid.x, grid.y);
      this.game.selectEmitter(emitter);
    }
  }

  pixelToGrid(px: number, py: number) {
    const gx = Math.floor(px / CELL_SIZE);
    const gy = Math.floor((py - UI_TOP_HEIGHT) / CELL_SIZE);
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return null;
    return { x: gx, y: gy };
  }
}
```

---

### Phase 7: Visual Polish (Day 4)

**7.1 Screen Shake**
```typescript
export class ScreenShake {
  game: Game;
  intensity: number = 0;
  duration: number = 0;

  shake(intensity: number, duration: number) {
    this.intensity = intensity;
    this.duration = duration;
  }

  update(dt: number) {
    if (this.duration > 0) {
      this.duration -= dt;
      const offsetX = (Math.random() - 0.5) * this.intensity * CELL_SIZE;
      const offsetY = (Math.random() - 0.5) * this.intensity * CELL_SIZE;
      this.game.gameLayer.position.set(offsetX, offsetY);
    } else {
      this.game.gameLayer.position.set(0, 0);
    }
  }
}
```

**7.2 Nexus Pulse Effect**
```typescript
export class Nexus extends Container {
  graphics: Graphics;
  pulse: number = 0;

  update(dt: number) {
    this.pulse += 3 * dt;
    const scale = 0.7 + Math.sin(this.pulse) * 0.3;

    this.graphics.clear();

    // Outer glow
    this.graphics
      .circle(0, 0, CELL_SIZE * 0.8 * scale)
      .fill({ color: 0x2244aa, alpha: scale * 0.3 });

    // Core
    this.graphics
      .circle(0, 0, CELL_SIZE * 0.4)
      .fill(0x4488ff);

    // Inner shine
    this.graphics
      .circle(-3, -3, CELL_SIZE * 0.15)
      .fill(0x88bbff);
  }
}
```

**7.3 Chain Lightning**
```typescript
export class ChainLightning {
  graphics: Graphics;
  effects: Array<{ from: Vec2; to: Vec2; timer: number }> = [];

  draw() {
    this.graphics.clear();

    for (const effect of this.effects) {
      const segments = 5;
      const jitter = 8;

      // Build jagged path
      const points: Vec2[] = [effect.from];
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        points.push({
          x: effect.from.x + (effect.to.x - effect.from.x) * t + (Math.random() - 0.5) * jitter,
          y: effect.from.y + (effect.to.y - effect.from.y) * t + (Math.random() - 0.5) * jitter,
        });
      }
      points.push(effect.to);

      // Outer glow
      this.graphics.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) {
        this.graphics.lineTo(p.x, p.y);
      }
      this.graphics.stroke({ color: 0xffff44, alpha: 0.5, width: 4 });

      // Inner bright line
      this.graphics.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) {
        this.graphics.lineTo(p.x, p.y);
      }
      this.graphics.stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
    }
  }
}
```

---

## File Structure After Migration

```
src/
├── main.ts              # Entry point, app init
├── Game.ts              # Main game class
├── config.ts            # (mostly unchanged)
├── types.ts             # (add PooledObject interface)
├── objects/
│   ├── Enemy.ts         # Container-based
│   ├── Emitter.ts       # Container-based
│   ├── Projectile.ts    # Sprite + pool
│   ├── Puddle.ts        # Graphics-based
│   └── Nexus.ts         # New - extracted
├── systems/
│   ├── CollisionSystem.ts
│   ├── WaveManager.ts
│   ├── ObjectPool.ts
│   ├── ParticleSystem.ts  # For death explosions, effects
│   └── ScreenShake.ts
├── ui/
│   ├── TopBar.ts
│   ├── BottomBar.ts
│   ├── TowerButton.ts
│   └── UpgradePanel.ts
├── rendering/
│   ├── GridRenderer.ts
│   ├── ChainLightning.ts
│   └── HoverIndicator.ts
└── input/
    └── InputHandler.ts
```

---

## Migration Checklist

- [ ] Install pixi.js v8, remove phaser
- [ ] Create main.ts with async init
- [ ] Create Game class with layer containers
- [ ] Port GridRenderer
- [ ] Port Enemy class (Container-based)
- [ ] Port Emitter class (Container-based)
- [ ] Create ObjectPool utility
- [ ] Port Projectile with pooling
- [ ] Implement CollisionSystem
- [ ] Port Puddle class
- [ ] Create Nexus component
- [ ] Port ChainLightning effect
- [ ] Port death explosion particles
- [ ] Create ScreenShake system
- [ ] Port TopBar UI
- [ ] Port BottomBar UI
- [ ] Implement InputHandler
- [ ] Add hover cell indicator
- [ ] Wire up wave system
- [ ] Test all tower types
- [ ] Test all enemy types
- [ ] Performance test with 500+ particles

---

## Performance Expectations

| Metric | Phaser (current) | PixiJS (expected) |
|--------|------------------|-------------------|
| Max particles | ~500 | 10,000+ |
| Bundle size | ~1MB | ~200KB |
| Frame time | ~12ms | ~4ms |
| Memory | Higher (physics) | Lower |

---

## Resources

- [PixiJS v8 Docs](https://pixijs.com/8.x/guides)
- [v8 Migration Guide](https://pixijs.com/8.x/guides/migrations/v8)
- [Tower Defense Tutorial](https://gamedev.land/tower-defense/)
- [ParticleContainer Guide](https://pixijs.com/8.x/guides/components/sprite-batch)
