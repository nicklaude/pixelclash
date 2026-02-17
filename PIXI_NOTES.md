# PixiJS v8 Migration Notes

Research notes for potential migration from Phaser to PixiJS v8.

## PixiJS v8 Key Changes

### Initialization
Async init is now required:
```javascript
import { Application } from 'pixi.js';

const app = new Application();
await app.init({
  roundPixels: true,
  // other options
});
```

### Imports
Single import style:
```javascript
import { Application, Sprite, Container, Graphics } from 'pixi.js';
```

### Graphics API (BREAKING CHANGE)
Draw shape THEN apply style (flipped from v7):
```javascript
// v8 way: shape first, then style
graphics.rect(0, 0, 100, 100).fill(0xff0000);
graphics.circle(50, 50, 25).stroke({ color: 0x00ff00, width: 2 });

// NOT the old way: style then shape
// graphics.beginFill(0xff0000).drawRect(...)  // OLD - DON'T USE
```

### Pixelated Look
For crisp pixel art:
```javascript
texture.scaleMode = 'nearest';
```

## Particle Performance

### ParticleContainer
- Can handle 100k+ particles at 60fps
- Use for high-volume particle effects
- Limitations: all children must use same texture/blend mode

### Object Pooling
Pre-allocate and reuse particles instead of creating/destroying:
```javascript
class ParticlePool {
  private pool: Particle[] = [];

  get(): Particle {
    return this.pool.pop() || new Particle();
  }

  release(particle: Particle) {
    particle.reset();
    this.pool.push(particle);
  }
}
```

### Note on @pixi/particle-emitter
The current particle system is simple enough that we don't need the full `@pixi/particle-emitter` library. Custom implementation is fine.

## Recommended Architecture

### Keep Existing Files
- `config.ts` - game constants and definitions (solid as-is)
- `types.ts` - TypeScript interfaces (solid as-is)

### New Class Structure
```
src/
├── objects/
│   ├── Tower.ts      - extends Container
│   ├── Enemy.ts      - extends Container
│   ├── Particle.ts   - extends Container (or use raw Sprite)
│   └── Projectile.ts - extends Container
├── managers/
│   ├── WaveManager.ts   - wraps generateWave()
│   ├── TowerManager.ts  - handles tower placement/upgrades
│   └── ParticleManager.ts - pool + batch rendering
└── scenes/
    ├── GameScene.ts
    └── UIScene.ts
```

### Collision Detection
Simple O(n*m) collision is fine for our scale:
- ~500 particles max
- ~100 enemies max
- = 50,000 checks/frame = trivial for modern JS

```javascript
// Simple AABB or circle collision
for (const particle of particles) {
  for (const enemy of enemies) {
    if (circleCollision(particle, enemy)) {
      // handle hit
    }
  }
}
```

## Resources

- **Best Tutorial**: https://gamedev.land/tower-defense/
- **v8 Migration Guide**: https://pixijs.com/8.x/guides/migrations/v8
- **PixiJS v8 Docs**: https://pixijs.com/8.x/guides

## Current Status

Currently using Phaser 3.85 with Arcade Physics. PixiJS would give us:
- Faster rendering (especially particles)
- More control over graphics
- Smaller bundle size
- But: need to implement our own physics/collision

Decision: Stick with Phaser for now since it's working. Consider PixiJS if we hit performance issues with particles.
