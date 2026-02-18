# PixelClash ECS-Based Feature Roadmap

A comprehensive implementation plan for new features, fully integrated with the existing ECS architecture.

---

## Table of Contents

1. [ECS Architecture Overview](#ecs-architecture-overview)
2. [Phase 1: Quick Wins & UI Polish](#phase-1-quick-wins--ui-polish)
3. [Phase 2: Turret Inspection Panel](#phase-2-turret-inspection-panel)
4. [Phase 3: Settings Menu](#phase-3-settings-menu)
5. [Phase 4: Procedural Turret Evolution Graphics](#phase-4-procedural-turret-evolution-graphics)
6. [Phase 5: Procedural Enemy Visuals](#phase-5-procedural-enemy-visuals)
7. [Phase 6: Procedural Tile Map](#phase-6-procedural-tile-map)
8. [Implementation Order & Dependencies](#implementation-order--dependencies)
9. [Implementation Checklist Summary](#implementation-checklist-summary)

---

## ECS Architecture Overview

The game already uses a Structure of Arrays (SoA) ECS pattern for high-performance entity management. Understanding this architecture is essential for all feature implementations.

### Current Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| `ECSWorld` | `src/ecs/world.ts` | Central manager with typed arrays for all entities |
| `EnemyArrays` | `src/ecs/types.ts` | Enemy data (x, y, health, flags, DOT, slow, etc.) |
| `ProjectileArrays` | `src/ecs/types.ts` | Projectile data (position, velocity, damage, pierce) |
| `EmitterArrays` | `src/ecs/types.ts` | Turret ECS data (currently hybrid with OOP `Emitter` class) |
| `DeathParticleArrays` | `src/ecs/types.ts` | Death explosion particles |
| `EnemyRenderer` | `src/ecs/EnemyRenderer.ts` | Syncs enemy arrays to PixiJS Graphics |
| `ProjectileRenderer` | `src/ecs/ProjectileRenderer.ts` | Syncs projectile arrays to PixiJS |
| Systems | `src/ecs/systems/` | Pure functions: movement, collision, damage, targeting |
| `GameECS` | `src/GameECS.ts` | Main game class orchestrating ECS and rendering |

### Key Patterns

- **Swap-remove** for O(1) entity deletion (see `removeEnemyAt()`, `removeProjectileAt()`)
- **Flag bits** for entity states (`EF_ACTIVE`, `EF_FLASHING`, `EF_ON_FIRE`, `EF_SLOWED`, etc.)
- **Archetypes** define base stats per entity type (in `src/ecs/archetypes.ts`)
- **Spatial hashing** for efficient collision queries (`updateEnemySpatialHash()`, `getEnemiesNear()`)
- **Renderers** pool PixiJS objects and sync each frame

### Existing Flag Constants

```typescript
// Enemy flags (src/ecs/types.ts)
EF_ACTIVE, EF_KNOCKBACKABLE, EF_HEAVY, EF_SPLITTER, EF_SHIELDED,
EF_BOSS, EF_ON_FIRE, EF_SLOWED, EF_FLASHING, EF_DIRTY, EF_HEALTH_DIRTY

// Projectile flags
PF_ACTIVE, PF_PIERCING, PF_DOT, PF_CHAIN, PF_SLOW, PF_PUDDLE

// Emitter flags
TF_ACTIVE, TF_AOE, TF_SLOW, TF_CHAIN, TF_SELECTED
```

### Hybrid OOP/ECS Note

Emitters currently use a hybrid approach:
- OOP: `Emitter` class extends PixiJS `Container` for rendering/selection
- ECS: `EmitterArrays` exist but are underutilized (turret logic is in `GameECS.runEmitterSystems()`)

Future work could fully migrate emitters to ECS, but current features can work with the hybrid approach.

---

## Phase 1: Quick Wins & UI Polish

**Estimated effort: 2-3 hours**
**Priority: High (immediate user value)**

### 1.1 Right-Click to Deselect

**Feature:** Right-clicking anywhere on the game grid deselects the currently selected turret, clears tower placement mode, and exits delete mode.

#### ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | None (UI state only) |
| Systems Updated | None |
| Renderers Updated | None |
| State Changed | `state.selectedEmitterType = null`, `state.selectedEmitterId = null`, `deleteMode = false` |

#### Implementation

```typescript
// In GameECS.setupInput(), add to the stage event listeners:
this.app.stage.on('rightclick', (e: FederatedPointerEvent) => {
    e.preventDefault();
    this.state.selectedEmitterType = null;
    this.selectEmitter(null);
    this.deleteMode = false;
});

// Also handle contextmenu to prevent browser menu:
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
```

#### Checklist

- [ ] Add `rightclick` event listener to `app.stage` in `setupInput()`
- [ ] Add `contextmenu` prevention on canvas element
- [ ] Clear `selectedEmitterType`, `selectedEmitterId`, and `deleteMode`
- [ ] Redraw hover graphics on deselect (already happens automatically)
- [ ] Test on desktop browsers (Chrome, Firefox, Safari)
- [ ] Test that touch-hold doesn't trigger (mobile)

---

### 1.2 Escape Key Enhancement

**Feature:** Pressing Escape key cycles through: deselect turret type -> deselect placed turret -> exit delete mode.

#### Implementation

```typescript
// In GameECS.onKeyDown()
if (e.key === 'Escape') {
    if (this.state.selectedEmitterType) {
        this.state.selectedEmitterType = null;
    } else if (this.state.selectedEmitterId) {
        this.selectEmitter(null);
    } else if (this.deleteMode) {
        this.deleteMode = false;
    }
}
```

#### Checklist

- [ ] Modify `onKeyDown` handler for prioritized Escape behavior
- [ ] Test cycling through all states

---

### 1.3 Keyboard Shortcuts Display

**Feature:** Show keyboard shortcuts in a help overlay (toggled with `?` or `H` key).

#### Shortcuts to Display

| Key | Action |
|-----|--------|
| 1-4 | Select tower type (Water, Fire, Electric, Goo) |
| Space/Enter | Start next wave |
| P | Toggle auto-wave pause |
| Escape | Deselect/cancel |
| Scroll wheel | Upgrade hovered turret |
| ? or H | Toggle help overlay |

#### Checklist

- [ ] Create `HelpOverlay` container in `uiLayer`
- [ ] Add `?` and `H` key handlers to toggle visibility
- [ ] Style as semi-transparent overlay with keyboard icons
- [ ] Add close button (X) and click-outside-to-close

---

## Phase 2: Turret Inspection Panel

**Estimated effort: 4-6 hours**
**Priority: High (core UX improvement)**

### 2.1 Panel Layout

When clicking a placed turret with no tower type selected, display a detailed inspection panel:

```
+---------------------------+
|  [Water Cannon]    Lv 3   |
|---------------------------|
|  DMG   4 x 1.9 = 7.6      |
|  RNG   6 x 1.36 = 8.2     |
|  RPS   15 x 1.45 = 21.7   |
|  KNK   120 x 1.6 = 192    |
|  Pierce  3                |
|  Special: knockback       |
|---------------------------|
|  [Upgrade $56]  [Sell $15]|
+---------------------------+
```

### 2.2 Stats to Display

| Stat | Source | Formula |
|------|--------|---------|
| Type Name | `EMITTER_DEFS[type].type` | Capitalize first letter |
| Level | `emitter.data_.level` | `Lv N` (0-indexed internally, display +1) |
| Damage | `def.damage` | `base x mult = effective` |
| Range | `def.range` | `cells, multiply by CELL_SIZE for pixels` |
| Fire Rate | `def.fireRate` | `shots/sec` |
| Knockback | `def.knockbackForce` | `force units` |
| Pierce | `def.particlePierce` | `hits per projectile` |
| Special | varies by type | DOT/Chain/Slow/Puddle info |
| Upgrade Cost | `getUpgradeCost(level)` | Next level cost |
| Sell Value | tracked investment | `floor(totalInvestment * 0.25)` |

### 2.3 Range Ring Visualization

Draw a semi-transparent circle showing turret attack range when selected.

#### ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | None (investment tracking in `EmitterData` OOP class) |
| New Property | `EmitterData.totalInvestment: number` - tracks cumulative gold spent |
| Systems Updated | None (panel is purely UI) |
| Renderers Updated | None (use separate Graphics for range ring) |

**Note:** Since emitters use hybrid OOP/ECS, we add `totalInvestment` to the `EmitterData` interface in `types.ts`, not to `EmitterArrays`.

#### New EmitterData Field

```typescript
// In src/types.ts - EmitterData interface
export interface EmitterData {
    // ... existing fields ...
    totalInvestment: number;  // NEW: tracks base cost + all upgrades
}

// In Emitter constructor:
this.data_.totalInvestment = def.cost;

// In upgradeEmitter():
emitter.data_.totalInvestment += upgradeCost;
```

#### Implementation

```typescript
// In GameECS class
private inspectPanel: Container | null = null;
private rangeGraphics: Graphics;  // Add to effectLayer

selectEmitter(id: number | null) {
    // Clear previous panel
    if (this.inspectPanel) {
        this.uiLayer.removeChild(this.inspectPanel);
        this.inspectPanel = null;
    }
    this.rangeGraphics.clear();

    // ... existing selection logic ...

    if (id !== null && !this.state.selectedEmitterType) {
        const emitter = this.emitters.find(e => e.data_.id === id);
        if (emitter) {
            this.inspectPanel = this.buildInspectPanel(emitter);
            this.uiLayer.addChild(this.inspectPanel);
            this.drawRangeRing(emitter);
        }
    }
}

buildInspectPanel(emitter: Emitter): Container {
    const panel = new Container();
    const def = EMITTER_DEFS[emitter.data_.type];
    const mult = getUpgradeMultiplier(emitter.data_.level);

    // Background
    const bg = new Graphics();
    bg.roundRect(0, 0, 180, 220, 8).fill({ color: 0x1a1a2e, alpha: 0.95 });
    bg.roundRect(0, 0, 180, 220, 8).stroke({ color: def.color, width: 2 });
    panel.addChild(bg);

    // ... add Text nodes for each stat ...
    // ... add Upgrade/Sell buttons ...

    // Position panel near turret, clamped to screen
    const worldPos = { x: emitter.x, y: emitter.y };
    let panelX = worldPos.x + CELL_SIZE;
    let panelY = worldPos.y - 50;
    panelX = Math.min(panelX, CANVAS_WIDTH - 190);
    panelY = Math.max(UI_TOP_HEIGHT + 10, Math.min(panelY, GAME_HEIGHT + UI_TOP_HEIGHT - 230));
    panel.position.set(panelX, panelY);

    return panel;
}

drawRangeRing(emitter: Emitter) {
    const def = EMITTER_DEFS[emitter.data_.type];
    const mult = getUpgradeMultiplier(emitter.data_.level);
    const range = def.range * mult.range * CELL_SIZE;

    this.rangeGraphics.clear();
    this.rangeGraphics.circle(emitter.x, emitter.y, range)
        .fill({ color: def.color, alpha: 0.15 })
        .stroke({ color: def.color, alpha: 0.5, width: 2 });
}
```

#### Checklist

- [ ] Add `totalInvestment: number` to `EmitterData` interface in `types.ts`
- [ ] Initialize `totalInvestment` to base cost in `Emitter` constructor
- [ ] Track investment in `upgradeEmitter()`: add upgrade cost
- [ ] Create `rangeGraphics: Graphics` in effectLayer (in constructor)
- [ ] Implement `buildInspectPanel(emitter): Container`
- [ ] Render all stats with computed multipliers
- [ ] Add type-specific special info (DOT damage, chain count, slow factor, puddle duration)
- [ ] Add Upgrade button with cost check and gold deduction
- [ ] Add Sell button with 25% refund calculation (`floor(totalInvestment * 0.25)`)
- [ ] Update `deleteEmitter()` to use `totalInvestment * 0.25` instead of fixed 50%
- [ ] Implement `drawRangeRing(emitter)` with `def.range * mult.range * CELL_SIZE`
- [ ] Clear range ring on deselect
- [ ] Clamp panel position to screen bounds
- [ ] Destroy panel on Escape key or clicking empty cell
- [ ] Destroy panel when selecting a tower type (placement mode)
- [ ] Refresh panel after upgrade (destroy and rebuild)
- [ ] Test panel positioning on edges of screen
- [ ] Test panel doesn't overlap bottom bar

---

## Phase 3: Settings Menu

**Estimated effort: 3-4 hours**
**Priority: High (user-requested features)**

### 3.1 Menu Location & Toggle

A collapsible settings panel accessible from a gear icon in the top bar.

### 3.2 Menu Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| Enemy Spawn Rate | Slider (0.5x - 2.0x) | 1.0x | Multiplier for spawn delay |
| Auto-Wave | Toggle | ON | Enable/disable auto-wave progression |
| Auto-Wave Delay | Slider (1s - 5s) | 2s | Delay between waves when auto-wave enabled |
| FPS Counter | Toggle | OFF | Show frames per second |
| Entity Count | Toggle | OFF | Show enemies/projectiles/emitters count |
| Difficulty | Dropdown | Normal | Easy/Normal/Hard presets |
| Sound Effects | Toggle | ON | Enable/disable sound (future-proofing) |
| Music | Toggle | ON | Enable/disable music (future-proofing) |
| Reset Game | Button | - | Restart from wave 1 |

### 3.3 Difficulty Presets

| Setting | Easy | Normal | Hard |
|---------|------|--------|------|
| Starting Gold | 300 | 200 | 150 |
| Starting Health | 30 | 20 | 10 |
| Enemy Health Scale | 0.8x | 1.0x | 1.3x |
| Wave Reward | 1.2x | 1.0x | 0.8x |
| Spawn Rate | 0.8x | 1.0x | 1.2x |

### 3.4 ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | None |
| Systems Updated | `processSpawnQueue` respects rate multiplier |
| New State | `settings: GameSettings` object |

#### Implementation Structure

```typescript
// New file: src/ui/SettingsMenu.ts
export interface GameSettings {
    spawnRateMultiplier: number;  // 0.5 - 2.0
    autoWaveEnabled: boolean;
    autoWaveDelay: number;        // 1000 - 5000 ms
    showFPS: boolean;
    showEntityCount: boolean;
    difficulty: 'easy' | 'normal' | 'hard';
    soundEnabled: boolean;
    musicEnabled: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
    spawnRateMultiplier: 1.0,
    autoWaveEnabled: true,
    autoWaveDelay: 2000,
    showFPS: false,
    showEntityCount: false,
    difficulty: 'normal',
    soundEnabled: true,
    musicEnabled: true,
};

// Difficulty presets affect:
// - STARTING_GOLD, STARTING_HEALTH (at game start)
// - generateWave() health scaling
// - Wave reward multiplier
// - spawnDelay calculation
```

#### Spawn Rate Integration

```typescript
// In GameECS.processSpawnQueue() or startWave():
const adjustedDelay = entry.delay / this.settings.spawnRateMultiplier;
```

#### FPS/Entity Counter Display

```typescript
// In GameECS.updateUI() or separate debug overlay
if (this.settings.showFPS) {
    this.fpsText.text = `FPS: ${Math.round(this.app.ticker.FPS)}`;
}
if (this.settings.showEntityCount) {
    this.entityText.text = `E:${this.world.enemies.count} P:${this.world.projectiles.count} T:${this.emitters.length}`;
}
```

#### Checklist

- [ ] Create `src/ui/SettingsMenu.ts` with `GameSettings` interface
- [ ] Add `settings: GameSettings` to `GameECS` class
- [ ] Add gear icon button to top bar (position: right side before WAVE button)
- [ ] Create collapsible panel with background overlay
- [ ] Implement spawn rate slider (modify `spawnDelay` calculation in `startWave()`)
- [ ] Connect auto-wave toggle to existing `autoWaveEnabled` property
- [ ] Implement auto-wave delay slider
- [ ] Add FPS counter display (use `app.ticker.FPS`)
- [ ] Add entity count display (`world.enemies.count`, `world.projectiles.count`, `emitters.length`)
- [ ] Implement difficulty dropdown
- [ ] Apply difficulty presets to starting values and wave generation
- [ ] Add sound/music toggles (UI only for now, no audio system yet)
- [ ] Add Reset Game button (calls `window.location.reload()` or proper reset)
- [ ] Persist settings to localStorage
- [ ] Load settings from localStorage on game start
- [ ] Add close button / click-outside-to-close behavior
- [ ] Ensure settings panel doesn't interfere with game input when open
- [ ] Test all sliders and toggles

---

## Phase 4: Procedural Turret Evolution Graphics

**Estimated effort: 6-8 hours**
**Priority: Medium (visual polish)**

### 4.1 Evolution Concept

Instead of a simple "+N" level indicator, turrets visually evolve as they level up:

| Level | Visual Changes |
|-------|----------------|
| 0 (Lv 1) | Simple 4-pixel base design (current) |
| 1 (Lv 2) | Add side modules (8-12 pixels total) |
| 2 (Lv 3) | Add top barrel/antenna (more detail) |
| 3 (Lv 4) | Add glow effects |
| 4+ (Lv 5+) | Add spinning/animated parts |

### 4.2 Turret Type Evolution Paths

Each turret type has a distinct evolution path:

#### Water Cannon Evolution

```
Level 0:        Level 1:        Level 2:        Level 3+:
   ##              ####            ####           [glow]
   ##             #####           ######          ######
                  ## ##          ## ## ##        ## ## ##
                                    ||           [spin]||
```

| Level | Description |
|-------|-------------|
| 0 | Simple blue square, single nozzle |
| 1 | Side tanks added, wider spray indicator |
| 2 | Triple barrel array, pressure gauge |
| 3 | Pulsing glow effect around barrels |
| 4+ | Spinning water turbine animation |

#### Fire Tower Evolution

| Level | Description |
|-------|-------------|
| 0 | Simple orange flame core |
| 1 | Side vents with ember particles |
| 2 | Larger flame chamber, heat shimmer |
| 3 | Fire ring glow effect |
| 4+ | Rotating flame jets |

#### Electric Tower Evolution

| Level | Description |
|-------|-------------|
| 0 | Simple yellow coil |
| 1 | Tesla coil side arms |
| 2 | Lightning rod antenna |
| 3 | Arc glow between coils |
| 4+ | Spinning capacitor rings |

#### Goo Tower Evolution

| Level | Description |
|-------|-------------|
| 0 | Simple green blob dispenser |
| 1 | Side storage tanks |
| 2 | Dripping nozzle array |
| 3 | Toxic glow aura |
| 4+ | Bubbling animation |

### 4.3 ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | None (level already tracked in `EmitterData.level`) |
| New Properties | `Emitter.hasAnimation: boolean`, `Emitter.animationPhase: number` |
| Systems Updated | None |
| Renderers Updated | `Emitter.redraw()` method enhanced |

Since emitters use OOP (`Emitter` class extends `Container`), the evolution graphics are implemented in `Emitter.redraw()`:

#### Implementation Approach

```typescript
// In src/objects/Emitter.ts

redraw() {
    this.graphics_.clear();
    const def = EMITTER_DEFS[this.data_.type];
    const level = this.data_.level;

    // Draw base for all levels
    this.drawBase(def.color);

    // Level 1+: Add side modules
    if (level >= 1) {
        this.drawSideModules(def.color);
    }

    // Level 2+: Add top detail
    if (level >= 2) {
        this.drawTopDetail(def.color);
    }

    // Level 3+: Add glow effect
    if (level >= 3) {
        this.drawGlowEffect(def.color);
    }

    // Level 4+: Animated parts (handled in update())
    this.hasAnimation = level >= 4;
}

private drawBase(color: number) {
    // Type-specific base drawing
    switch (this.data_.type) {
        case 'water':
            this.drawWaterBase(color);
            break;
        case 'fire':
            this.drawFireBase(color);
            break;
        case 'electric':
            this.drawElectricBase(color);
            break;
        case 'goo':
            this.drawGooBase(color);
            break;
    }
}

// Animation handled in update loop
update(dt: number) {
    // ... existing targeting/firing logic ...

    if (this.hasAnimation) {
        this.animationPhase += dt * 2;
        this.redrawAnimatedParts();
    }
}
```

#### Checklist

- [ ] Design pixel art sketches for each turret type at each level (on paper/Figma first)
- [ ] Add `hasAnimation: boolean` and `animationPhase: number` to `Emitter` class
- [ ] Implement `drawBase(color)` with type-specific switch
- [ ] Implement `drawWaterBase()`, `drawFireBase()`, `drawElectricBase()`, `drawGooBase()`
- [ ] Implement `drawSideModules(color)` for level 1+
- [ ] Implement `drawTopDetail(color)` for level 2+
- [ ] Implement `drawGlowEffect(color)` using alpha-blended circles
- [ ] Implement `redrawAnimatedParts()` for spinning/pulsing elements
- [ ] Create separate `Graphics` object for animated parts (avoid redrawing static parts)
- [ ] Call animation update from `Emitter.update()` when animated
- [ ] Update `Emitter.redraw()` to call appropriate level methods
- [ ] Remove old "+N" level indicator text
- [ ] Test visual progression for all 4 turret types across levels 0-5
- [ ] Ensure animations don't cause performance issues (profile on mobile)

---

## Phase 5: Procedural Enemy Visuals

**Estimated effort: 4-6 hours**
**Priority: Medium (visual variety)**

### 5.1 Variation Concept

Enemies within each type have procedurally generated visual variations:

| Variation Type | Range | Application |
|----------------|-------|-------------|
| Color Shift | +/- 20% hue/saturation | Base body color |
| Size Variation | +/- 15% | Overall scale |
| Pattern/Markings | 3-5 variants per type | Decorative details |
| Movement Animation | Unique timing | Bob/sway speed |

### 5.2 Implementation Strategy

Store variation seeds in enemy arrays, generate visuals deterministically from seed.

#### New EnemyArrays Fields

```typescript
// In src/ecs/types.ts - EnemyArrays interface
export interface EnemyArrays {
    // ... existing fields ...

    // Visual variation (procedural)
    seed: Uint16Array;           // Random seed per enemy (0-65535)
    colorVariation: Int8Array;   // Hue shift (-20 to +20)
    sizeVariation: Int8Array;    // Size delta (-15 to +15 percent)
    patternId: Uint8Array;       // Pattern variant (0-4)
    animPhase: Float32Array;     // Animation phase offset
}
```

#### Seed Generation

```typescript
// When spawning enemy in ECSWorld.spawnEnemy():
const seed = Math.random() * 65535 | 0;
e.seed[i] = seed;

// Derive variations from seed using simple hash
e.colorVariation[i] = ((seed * 7) % 41) - 20;     // -20 to +20
e.sizeVariation[i] = ((seed * 13) % 31) - 15;    // -15 to +15
e.patternId[i] = (seed * 3) % 5;                 // 0-4
e.animPhase[i] = ((seed * 17) % 628) / 100;      // 0 to ~2PI
```

### 5.3 Renderer Updates

Modify `EnemyRenderer.drawEnemyBody()` to use variations:

```typescript
private drawEnemyBody(
    g: Graphics,
    i: number,
    enemies: EnemyArrays
): void {
    const typeId = enemies.type[i];
    const isFlashing = enemies.flashTimer[i] > 0;
    const isOnFire = enemies.dotTimer[i] > 0;
    const baseSize = enemies.size[i];
    const scale = enemies.scale[i];

    // Apply variations
    const colorVariation = enemies.colorVariation[i];
    const sizeVariation = enemies.sizeVariation[i];
    const patternId = enemies.patternId[i];

    g.clear();

    const arch = ENEMY_ARCHETYPES[typeId];
    const baseColor = arch.color;

    // Apply color variation
    const color = isFlashing ? 0xffffff : this.shiftColor(baseColor, colorVariation);

    // Apply size variation
    const size = baseSize * scale * (1 + sizeVariation / 100);

    // Draw with pattern variation
    this.drawEnemyShape(g, typeId, color, size, patternId, isOnFire);
}

private shiftColor(color: number, shift: number): number {
    // Convert RGB to HSL, shift hue, convert back to RGB
    // shift is -20 to +20 (degrees out of 360)
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    // Simple approximation: adjust saturation instead of hue for simplicity
    const factor = 1 + shift / 100;
    return (
        (Math.min(255, Math.max(0, r * factor)) << 16) |
        (Math.min(255, Math.max(0, g * factor)) << 8) |
        Math.min(255, Math.max(0, b * factor))
    );
}
```

### 5.4 Pattern Variants by Type

#### Grunt Patterns

| Pattern ID | Description |
|------------|-------------|
| 0 | Plain square (default) |
| 1 | Horizontal stripe |
| 2 | Vertical stripe |
| 3 | Corner dots |
| 4 | X marking |

#### Fast Enemy Patterns

| Pattern ID | Description |
|------------|-------------|
| 0 | Plain diamond |
| 1 | Speed lines |
| 2 | Chevron marking |
| 3 | Gradient fade |
| 4 | Double outline |

#### Tank Patterns

| Pattern ID | Description |
|------------|-------------|
| 0 | Plain rectangle |
| 1 | Armor plates |
| 2 | Rivets |
| 3 | Battle damage |
| 4 | Shield emblem |

### 5.5 ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | `EnemyArrays` - add `seed`, `colorVariation`, `sizeVariation`, `patternId`, `animPhase` |
| Systems Updated | None (variations are purely visual) |
| Renderers Updated | `EnemyRenderer.drawEnemyBody()` uses variation data |

#### Checklist

- [ ] Add 5 new typed arrays to `EnemyArrays` interface in `src/ecs/types.ts`
- [ ] Update `createEnemyArrays()` to initialize new arrays
- [ ] Generate variations in `ECSWorld.spawnEnemy()` using seed-based derivation
- [ ] Implement `shiftColor(color, shift)` for color variation
- [ ] Update `EnemyRenderer.sync()` to pass variation data to drawing
- [ ] Update `EnemyRenderer.drawEnemyBody()` signature and logic
- [ ] Design 5 pattern variants per enemy type (6 types x 5 = 30 patterns)
- [ ] Implement `drawEnemyShape()` with pattern switch for each type
- [ ] Add subtle bob animation using `animPhase` in `EnemyRenderer.sync()`
- [ ] Test variation distribution looks good (not too uniform, not too chaotic)
- [ ] Profile performance impact of additional drawing complexity

---

## Phase 6: Procedural Tile Map

**Estimated effort: 8-12 hours**
**Priority: Lower (architectural change)**

### 6.1 Tile Types

| Tile | ID | Color | Enemy | Projectile | Turret |
|------|----|-------|-------|------------|--------|
| **Sand** | 0 | `0xc8a96e` | Walk (path) | Blocked | No |
| **Stone** | 1 | `0x667788` | Impassable | Blocked | No |
| **Water** | 2 | `0x2255aa` | Drown if small | Pass over | No |
| **Nexus** | 3 | `0x4488ff` | End point | - | No |
| **Foundation** | 4 | `0x4a4a3a` | Cannot walk | Blocked | **Yes** |

### 6.2 New Type Definitions

```typescript
// In src/types.ts
export type TileType = 'sand' | 'stone' | 'water' | 'nexus' | 'foundation';

export interface MapData {
    tiles: Uint8Array;            // Flattened [y * width + x] grid
    width: number;
    height: number;
    path: Vec2[];                 // World-space waypoints
    foundationCells: Vec2[];      // Valid turret placement cells
    nexus: Vec2;                  // Grid coords of nexus
    spawnPoint: Vec2;             // Grid coords of enemy spawn
}

// Tile type constants
export const TILE_SAND = 0;
export const TILE_STONE = 1;
export const TILE_WATER = 2;
export const TILE_NEXUS = 3;
export const TILE_FOUNDATION = 4;
```

### 6.3 Generator Algorithm

Create `src/MapGenerator.ts`:

```typescript
export interface GeneratorConfig {
    gridSize: number;           // Default 20
    foundationRadius: number;   // Default 4 (9x9 ring around nexus)
    waterClusterCount: number;  // Default 3-5
    seed?: number;
}

export function generateMap(config: GeneratorConfig): MapData {
    const rng = new SeededRandom(config.seed ?? Date.now());

    // Step 1: Initialize all as stone
    const tiles = new Uint8Array(config.gridSize * config.gridSize);
    tiles.fill(TILE_STONE);

    // Step 2: Place nexus at center
    const nexus = {
        x: Math.floor(config.gridSize / 2),
        y: Math.floor(config.gridSize / 2)
    };
    setTile(tiles, config.gridSize, nexus.x, nexus.y, TILE_NEXUS);

    // Step 3: Place foundation ring (9x9 around nexus)
    const foundationCells: Vec2[] = [];
    for (let dy = -config.foundationRadius; dy <= config.foundationRadius; dy++) {
        for (let dx = -config.foundationRadius; dx <= config.foundationRadius; dx++) {
            if (dx === 0 && dy === 0) continue; // Skip nexus
            const fx = nexus.x + dx;
            const fy = nexus.y + dy;
            if (inBounds(fx, fy, config.gridSize)) {
                setTile(tiles, config.gridSize, fx, fy, TILE_FOUNDATION);
                foundationCells.push({ x: fx, y: fy });
            }
        }
    }

    // Step 4: Carve sand path from random edge to foundation ring
    const spawnPoint = pickRandomEdge(rng, config.gridSize);
    const pathCells = carvePath(tiles, config.gridSize, spawnPoint, nexus, rng);

    // Step 5: Scatter water clusters adjacent to path
    scatterWater(tiles, config.gridSize, pathCells, rng, config.waterClusterCount);

    // Step 6: Validate connectivity
    if (!validatePath(tiles, config.gridSize, spawnPoint, nexus)) {
        // Retry with different seed
        return generateMap({ ...config, seed: (config.seed ?? 0) + 1 });
    }

    // Step 7: Extract world-space waypoints
    const path = extractWaypoints(pathCells, config.gridSize);

    return {
        tiles,
        width: config.gridSize,
        height: config.gridSize,
        path,
        foundationCells,
        nexus,
        spawnPoint,
    };
}
```

#### Path Carving Algorithm

Drunk-walk with bias toward nexus:
- 70% chance: move toward nexus (Manhattan-closest axis)
- 30% chance: move perpendicular
- Never revisit cells (prevents loops/branches)
- Backtrack if stuck

### 6.4 ECS Integration

| Aspect | Details |
|--------|---------|
| Arrays Modified | None (map is static per game) |
| New State | `GameECS.map: MapData` replaces `pathCells` and `worldPath` |
| New World Method | `ECSWorld.setMap(map)`, `ECSWorld.getTileAt(gx, gy)` |
| Systems Updated | Movement system uses `map.path`, collision checks tile types |

#### New ECSWorld Methods

```typescript
// In src/ecs/world.ts
export class ECSWorld {
    // ... existing ...

    // Map data (set once per game)
    map: MapData | null = null;

    setMap(map: MapData): void {
        this.map = map;
        this.worldPath = map.path;  // For enemy pathfinding
    }

    getTileAt(gx: number, gy: number): number {
        if (!this.map) return TILE_STONE;
        if (gx < 0 || gx >= this.map.width || gy < 0 || gy >= this.map.height) {
            return TILE_STONE;
        }
        return this.map.tiles[gy * this.map.width + gx];
    }
}
```

### 6.5 Gameplay Rule Changes

#### Turret Placement

```typescript
// In GameECS.canPlaceEmitter()
canPlaceEmitter(gx: number, gy: number): boolean {
    const tile = this.world.getTileAt(gx, gy);
    return tile === TILE_FOUNDATION && !this.occupiedCells.has(`${gx},${gy}`);
}
```

#### Projectile vs Stone

```typescript
// In projectile movement system or collision processing
const gridX = Math.floor(projectiles.x[i] / CELL_SIZE);
const gridY = Math.floor((projectiles.y[i] - UI_TOP_HEIGHT) / CELL_SIZE);
if (world.getTileAt(gridX, gridY) === TILE_STONE) {
    deadProjectileIndices.push(i);
}
```

#### Enemy vs Water (Drowning)

```typescript
// Add to enemy movement system or separate system
const tile = world.getTileAt(
    Math.floor(enemies.x[i] / CELL_SIZE),
    Math.floor((enemies.y[i] - UI_TOP_HEIGHT) / CELL_SIZE)
);

if (tile === TILE_WATER) {
    const typeName = ENEMY_TYPE_REVERSE[enemies.type[i]];
    const def = ENEMY_DEFS[typeName];

    if (def.size < 10) {
        // Small enemy: rapid DOT (drowning)
        enemies.health[i] -= 300 * dt;
        enemies.flags[i] |= EF_DIRTY;
        // TODO: spawn splash particles
    } else {
        // Large enemy: strong deceleration only
        enemies.vx[i] *= 0.5;
        enemies.vy[i] *= 0.5;
    }
}
```

### 6.6 Grid Rendering Updates

```typescript
// In GameECS.drawGrid()
drawGrid() {
    const g = this.gridGraphics;
    g.clear();

    const map = this.world.map;
    if (!map) {
        // Fallback to old rendering
        return this.drawGridLegacy();
    }

    const TILE_COLORS = {
        [TILE_SAND]: 0xc8a96e,
        [TILE_STONE]: 0x667788,
        [TILE_WATER]: 0x2255aa,
        [TILE_NEXUS]: 0x4488ff,
        [TILE_FOUNDATION]: 0x4a4a3a,
    };

    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            const tile = map.tiles[y * map.width + x];
            if (tile === TILE_NEXUS) continue;  // Drawn by drawNexus()

            const color = TILE_COLORS[tile];
            const px = x * CELL_SIZE;
            const py = y * CELL_SIZE + UI_TOP_HEIGHT;

            g.rect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2).fill(color);

            // Stone bevel (darker bottom/right edges)
            if (tile === TILE_STONE) {
                g.rect(px + 1, py + CELL_SIZE - 3, CELL_SIZE - 2, 2)
                    .fill(this.darkenColor(color, 0.3));
                g.rect(px + CELL_SIZE - 3, py + 1, 2, CELL_SIZE - 2)
                    .fill(this.darkenColor(color, 0.3));
            }

            // Water shimmer
            if (tile === TILE_WATER) {
                const shimmerY = ((this.nexusPulse * 10) % (CELL_SIZE * 2)) - CELL_SIZE;
                g.rect(px + 2, py + shimmerY, CELL_SIZE - 4, 3)
                    .fill({ color: 0x88aaff, alpha: 0.3 });
            }

            // Foundation corner dots
            if (tile === TILE_FOUNDATION) {
                g.circle(px + 4, py + 4, 1).fill(0x5a5a4a);
                g.circle(px + CELL_SIZE - 4, py + 4, 1).fill(0x5a5a4a);
                g.circle(px + 4, py + CELL_SIZE - 4, 1).fill(0x5a5a4a);
                g.circle(px + CELL_SIZE - 4, py + CELL_SIZE - 4, 1).fill(0x5a5a4a);
            }
        }
    }
}
```

### 6.7 Recommended Grid Size

| Option | Grid | Cell px | Game Area | Pros | Cons |
|--------|------|---------|-----------|------|------|
| A (Current) | 16x16 | 36 | 576x576 | No work | Cramped paths |
| **B (Recommended)** | 20x20 | 32 | 640x640 | More room | Slight UI adjustment |
| C | 24x24 | 28 | 672x672 | Very spacious | Small cells |

**Recommendation: Option B (20x20 at 32px)**

Changes needed:
- `GRID_SIZE = 20`
- `CELL_SIZE = 32`
- `CANVAS_WIDTH/HEIGHT` recalculated
- `fitToScreen` handles the rest

#### Checklist

**Types & Config**
- [ ] Add `TileType`, `MapData` interfaces to `types.ts`
- [ ] Add tile type constants (`TILE_SAND`, etc.)
- [ ] Update `GRID_SIZE = 20`, `CELL_SIZE = 32` in `config.ts`
- [ ] Remove `PATH` constant (replaced by generator)
- [ ] Remove `getPathCells()` function (replaced by `map.path`)

**Map Generator**
- [ ] Create `src/MapGenerator.ts`
- [ ] Implement `SeededRandom` utility class
- [ ] Implement `generateMap(config): MapData`
- [ ] Implement `carvePath()` drunk-walk algorithm
- [ ] Implement `scatterWater()` for water clusters
- [ ] Implement `validatePath()` flood-fill connectivity check
- [ ] Implement `extractWaypoints()` for enemy path
- [ ] Add retry loop (max 10 seeds) on validation failure
- [ ] Unit test map generator with various seeds

**ECS World Integration**
- [ ] Add `map: MapData | null` property to `ECSWorld`
- [ ] Add `setMap(map)` method to `ECSWorld`
- [ ] Add `getTileAt(gx, gy)` method to `ECSWorld`
- [ ] Update `setWorldPath()` to use `map.path`

**GameECS Integration**
- [ ] Call `generateMap()` in constructor
- [ ] Store result in `world.setMap()`
- [ ] Replace `pathCells` with `map.foundationCells` for placement
- [ ] Update `canPlaceEmitter()` to check `TILE_FOUNDATION`
- [ ] Update `drawGrid()` for per-tile rendering
- [ ] Add stone bevel effect
- [ ] Add water shimmer animation
- [ ] Add foundation corner dots
- [ ] Keep `drawGridLegacy()` as fallback

**Gameplay Rules**
- [ ] Projectile removal on stone tile hit
- [ ] Enemy push-out from stone on knockback (clamp position)
- [ ] Small enemy drowning DOT on water
- [ ] Large enemy deceleration on water
- [ ] Splash particles on water death

**Scaling & Testing**
- [ ] Verify `fitToScreen` works at new canvas size
- [ ] Test bottom bar touch targets at 360px screen width
- [ ] Update `enemySpatialHash` cell size if needed
- [ ] Test path generation creates interesting layouts
- [ ] Test path always connects spawn to nexus

---

## Implementation Order & Dependencies

### Recommended Order

```
Phase 1: Quick Wins (2-3 hours)
    |
    v
Phase 2: Turret Inspection (4-6 hours)
    |
    v
Phase 3: Settings Menu (3-4 hours)
    |
    +-----> Phase 4: Turret Evolution (6-8 hours) [parallel]
    |
    +-----> Phase 5: Enemy Visuals (4-6 hours) [parallel]
    |
    v
Phase 6: Procedural Map (8-12 hours)
```

### Rationale

1. **Phase 1** provides immediate quality-of-life improvements
2. **Phase 2** adds core UX (inspection panel) that users expect
3. **Phase 3** adds settings menu with requested features
4. **Phases 4 & 5** are visual polish and can be done in parallel
5. **Phase 6** is last because it changes game architecture; turret/enemy visuals are purely additive

### Dependencies

- Phase 2 depends on nothing
- Phase 3 depends on nothing
- Phase 4 depends on nothing (Emitter class already exists)
- Phase 5 depends on nothing (adds arrays, doesn't change existing logic)
- Phase 6 depends on nothing technically, but should be done last due to scope

---

## Implementation Checklist Summary

### Phase 1: Quick Wins (2-3 hours)

- [ ] Right-click deselect (`rightclick` event)
- [ ] Contextmenu prevention
- [ ] Enhanced Escape key behavior
- [ ] Keyboard shortcuts help overlay

### Phase 2: Turret Inspection (4-6 hours)

- [ ] `totalInvestment` tracking on `EmitterData`
- [ ] Range ring graphics
- [ ] Inspection panel UI
- [ ] All stats display
- [ ] Upgrade button
- [ ] Sell button with 25% refund
- [ ] Panel positioning & lifecycle

### Phase 3: Settings Menu (3-4 hours)

- [ ] Settings menu container & gear icon
- [ ] Spawn rate slider
- [ ] Auto-wave toggle & delay slider
- [ ] FPS counter toggle
- [ ] Entity count toggle
- [ ] Difficulty presets
- [ ] localStorage persistence
- [ ] Reset game button

### Phase 4: Turret Evolution (6-8 hours)

- [ ] Level 0 base designs (4 types)
- [ ] Level 1 side modules
- [ ] Level 2 top details
- [ ] Level 3 glow effects
- [ ] Level 4+ animations
- [ ] Animation phase tracking
- [ ] Remove "+N" indicator

### Phase 5: Enemy Visuals (4-6 hours)

- [ ] Variation arrays (seed, color, size, pattern, anim)
- [ ] Seed-based variation generation
- [ ] Color shift function
- [ ] 30 pattern variants (6 types x 5)
- [ ] Renderer updates
- [ ] Bob animation

### Phase 6: Procedural Map (8-12 hours)

- [ ] Type definitions & constants
- [ ] Map generator with drunk-walk
- [ ] Path carving & water scattering
- [ ] Validation & waypoint extraction
- [ ] Grid rendering updates
- [ ] Tile-specific visual effects
- [ ] Gameplay rules (projectile/stone, enemy/water)
- [ ] Grid resize to 20x20

---

## Estimated Total Effort

| Phase | Hours | Priority |
|-------|-------|----------|
| Phase 1 | 2-3 | High |
| Phase 2 | 4-6 | High |
| Phase 3 | 3-4 | High |
| Phase 4 | 6-8 | Medium |
| Phase 5 | 4-6 | Medium |
| Phase 6 | 8-12 | Lower |
| **Total** | **27-39** | - |

### Effort Notes

- Estimates assume familiarity with the codebase
- Phase 6 has highest variance (map generator complexity)
- Visual phases (4, 5) include design/iteration time
- All phases should include testing on mobile browsers
