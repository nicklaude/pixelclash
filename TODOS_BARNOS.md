# PixelClash — Next Feature Roadmap

Two major feature areas: **turret inspection UI** and **procedural tile-based maps**.
These build on each other — the map system defines where turrets can go, and the
inspection panel surfaces stats that become more meaningful once upgrades are tied
to a real layout.

---

## Feature 1: Turret Inspection Panel

### Vision
Clicking a placed turret with no tower type selected currently does nothing useful.
It should open a compact side-panel (or in-place overlay) showing live stats, the
turret's attack range ring, and quick-action buttons (upgrade / sell).

---

### 1.1 Panel Layout

```
┌─────────────────────────┐
│  [Water Cannon]  Lv 3   │
│ ─────────────────────── │
│  DMG   4 × 1.9 = 7.6    │
│  RNG   6 × 1.36 = 8.2   │
│  RPS   15 × 1.45 = 21.7 │
│  KNK   120 × 1.6 = 192  │
│  Pierce  3              │
│  Special: knockback      │
│ ─────────────────────── │
│  [Upgrade $56]  [Sell $15]│
└─────────────────────────┘
```

Panel appears anchored to the selected turret cell, nudged inward if near an edge.

---

### 1.2 What to Show

| Stat | Source | Display |
|------|--------|---------|
| Type | `EmitterDef.type` | icon color + name |
| Level | `EmitterData.level` | `Lv N` |
| Damage | `def.damage × mult.damage` | base × mult = effective |
| Range | `def.range × mult.range` | cells, shown as radius ring |
| Fire rate | `def.fireRate × mult.fireRate` | shots/sec |
| Knockback | `def.knockbackForce × mult.knockback` | force units |
| Pierce | `def.particlePierce` | hits per projectile |
| Special | `dotDamage / chainCount / slowFactor` | one line, type-specific |
| Upgrade cost | `getUpgradeCost(level)` | next level cost |
| Sell value | `floor(totalInvestment * 0.25)` | 25% of (base cost + all upgrade costs paid) |

---

### 1.3 Range Ring

- Draw a semi-transparent circle on the `effectLayer` when a turret is selected
- Radius = `def.range × getUpgradeMultiplier(level).range × CELL_SIZE`
- Redraw on upgrade; clear on deselect
- Reuse the existing `hoverGraphics` or add a dedicated `rangeGraphics: Graphics`

---

### 1.4 Panel Container

Add `inspectPanel: Container | null = null` to `GameECS` (the active game class post-ECS refactor).

On `selectEmitter(id)`:
1. Destroy old panel if any
2. Build a new `Container` with a `Graphics` background + `Text` nodes for each stat
3. Position it beside the selected cell (clamp to canvas bounds)
4. Add Upgrade and Sell buttons with `pointertap` listeners
5. Re-build the panel on `upgradeEmitter()` so stats refresh immediately

Panel should be added to `uiLayer` so it renders above all game objects.

Note: emitters remain OOP (`Emitter extends Container` with `data_: EmitterData`) in the
ECS architecture — only enemies and projectiles moved to typed arrays. So `totalInvestment`
goes on `EmitterData` in `types.ts` as normal, and the panel reads from `emitter.data_` directly.

---

### 1.5 Implementation Checklist

- [ ] Add `rangeGraphics: Graphics` to `GameECS`, insert into `effectLayer`
- [ ] Draw range ring in `selectEmitter()`, clear in deselect
- [ ] Create `buildInspectPanel(emitter: Emitter): Container` helper in `GameECS`
- [ ] Render all stats from table above using computed multipliers
- [ ] Add Upgrade button → calls `upgradeEmitter()` then rebuilds panel
- [ ] Track `totalInvestment` on `EmitterData` (base cost + every upgrade cost paid at placement/upgrade time)
- [ ] Add Sell button → calls `deleteEmitter()` then destroys panel
- [ ] `deleteEmitter()` refund = `floor(emitter.data_.totalInvestment * 0.25)`
- [ ] Clamp panel X/Y so it never clips outside `CANVAS_WIDTH / CANVAS_HEIGHT`
- [ ] Destroy panel when clicking empty cell or pressing Escape
- [ ] Test on narrow screens (panel must not overlap bottom bar)

---

## Feature 2: Procedural Tile Map

### Vision
Replace the hard-coded spiral `PATH` with a generated tile grid each game.
Five tile types define the terrain. The nexus is always at grid center;
foundation tiles radiate around it as the only valid turret spots.
Stone obstacles block both enemies and projectiles, creating natural chokepoints.
Water gives small enemies a hazard and lets projectiles fly freely over it.

---

### 2.1 Tile Types

| Tile | ID | Color (approx) | Enemy | Projectile | Turret |
|------|----|----------------|-------|------------|--------|
| **Sand** | `sand` | `0xc8a96e` | walk on (path) | blocked | no |
| **Stone** | `stone` | `0x667788` | impassable | blocked | no |
| **Water** | `water` | `0x2255aa` | drown if small* | pass over | no |
| **Nexus** | `nexus` | (existing glow) | end point | — | no |
| **Foundation** | `foundation` | `0x4a4a3a` | cannot walk | blocked | **yes** |

*Small enemy threshold: enemies with `def.size < 10` (grunt, fast) can be knocked into
water by sufficient knockback force. On entry they take rapid DOT and despawn with a
splash particle burst. Tank, shielded, splitter, boss are too heavy and stop at the edge.

---

### 2.2 New `TileType` and `TileGrid`

Add to `types.ts`:
```typescript
export type TileType = 'sand' | 'stone' | 'water' | 'nexus' | 'foundation';

export interface Tile {
    type: TileType;
    x: number;   // grid coords
    y: number;
}
```

Replace the `PATH` array and `getPathCells()` in `config.ts` with a
`MapData` object produced by the generator:
```typescript
export interface MapData {
    tiles: TileType[][];          // [y][x] grid
    path: Vec2[];                 // world-space waypoints for enemy movement
    foundationCells: Vec2[];      // grid cells where turrets may be placed
    nexus: Vec2;                  // grid coords of nexus center
}
```

---

### 2.3 Generator Algorithm (`src/MapGenerator.ts`)

**Step 1 — Place nexus**
- Always at `{ x: floor(GRID_SIZE/2), y: floor(GRID_SIZE/2) }`
- Mark a **9×9 block** centered on the nexus as `foundation` (all cells within ±4 in x and y)
  - That is 80 foundation cells + 1 nexus cell = 81 total cells reserved
  - Foundation ring must fit entirely inside the grid; with a 20×20 grid and nexus at (10,10)
    the ring spans (6,6)→(14,14) with 1-cell margin on every side
  - If the grid is enlarged later, this stays proportional — the ring is always 4 cells deep

**Step 2 — Carve sand path (single, guaranteed)**
- Pick one random edge cell as the spawn point (any of the 4 sides, outside the foundation ring)
- Use a **corridor-carve** approach that guarantees exactly one path and no branches:
  1. Walk from spawn toward the nexus using a biased random walk:
     - At each step, 70% chance to move toward nexus (Manhattan-closest axis), 30% chance of perpendicular drift
     - Never revisit a cell already marked `sand` (prevents loops / branches)
     - If the walk gets stuck (surrounded by visited or foundation cells), backtrack one step and retry
  2. Carve **2 cells wide**: for each center-line cell, also mark its perpendicular neighbor as `sand`
     (choose the neighbor that isn't already sand and isn't inside the foundation ring)
  3. The path terminates when it touches any cell of the foundation ring perimeter
- Mark all carved cells as `sand`
- No branching: the drunk walk's no-revisit rule combined with single-start/single-end guarantees
  there is exactly one connected route from spawn to nexus

**Step 3 — Scatter water**
- Place water clusters (3–7 cells each) adjacent to but not overlapping the sand path
- Water clusters prefer cells reachable by knockback (1–2 cells off the path edge)
- Minimum distance from nexus: 4 cells

**Step 4 — Fill stone**
- All remaining non-sand, non-water, non-nexus, non-foundation cells → `stone`

**Step 5 — Validate**
- Confirm sand path is fully connected (flood fill from spawn to nexus)
- Confirm at least 8 foundation cells exist
- If validation fails, regenerate with a different seed (max 10 retries)

**Step 6 — Extract waypoints**
- Trace the center-line of the sand path from spawn edge to nexus
- Produce a `Vec2[]` of world-pixel waypoints for `Enemy` path following
- Store these as `MapData.path`

---

### 2.4 Tile Rendering (`drawGrid()`)

Update `Game.drawGrid()` to read from `MapData.tiles` instead of `pathCells`:

```typescript
const TILE_COLORS: Record<TileType, number> = {
    sand:       0xc8a96e,
    stone:      0x667788,
    water:      0x2255aa,
    nexus:      0x1a3366,   // drawn separately with pulse
    foundation: 0x4a4a3a,
};
```

Water tiles get an animated shimmer: every N frames draw a slightly lighter
horizontal band that scrolls downward (simple offset mod on `this.nexusPulse`).

Stone tiles get a subtle bevel: draw the cell slightly darker on bottom/right edges.

---

### 2.5 Gameplay Rule Changes

**Turret placement**
- `canPlaceEmitter()` changes from "not a path cell, not nexus" to:
  `tile === 'foundation'` only

**Projectile vs. stone**
- In `ecs/systems/movement.ts → updateProjectileMovement()`, after updating position,
  convert the projectile's world coordinates to a grid cell and look up the tile.
  If `stone`, mark the projectile dead (set lifespan to 0 or flag inactive).
- The systems need access to the tile grid: add `tiles: TileType[][]` to `ECSWorld`
  and pass it into the movement system call from `GameECS.update()`.

**Projectile vs. water**
- Water tiles are transparent to projectiles — no check needed, they pass freely.

**Enemy vs. stone**
- Path generator guarantees enemies never route through stone under normal movement.
- If knockback pushes an enemy into a stone cell, clamp its position back in
  `ecs/systems/movement.ts → updateEnemyMovement()`: after applying velocity, if the
  new grid cell is `stone`, reverse the displacement for that axis.

**Enemy vs. water (drowning)**
- Add a terrain check pass in `ecs/systems/movement.ts` (or a new `terrain.ts` system):
  each frame, if enemy center lands on a water tile:
  - If `EF_HEAVY` flag NOT set (grunt, fast): call `world.applyDOT(i, 300, 1)` — rapid
    burn. Enemy despawns via normal death path when health hits 0.
  - If `EF_HEAVY` flag set (tank, shielded, splitter, boss): multiply `vx`/`vy` by `0.5`
    while on water — strong drag, enemy cannot be pushed further in.
- Splash particle burst on water-drown death: detect in `GameECS` death-processing loop
  when a killed enemy's last tile was water, call `world.spawnDeathExplosion()` with a
  blue-tinted color override.

---

### 2.6 Map Size & Scaling

Current: `16×16` grid at `36px/cell` = `576×576` game area.

Proposed options:

| Option | Grid | Cell px | Game area | Notes |
|--------|------|---------|-----------|-------|
| A — keep | 16×16 | 36 | 576×576 | No scaling work needed |
| B — wider path | 20×20 | 32 | 640×640 | +11% height, adjust UI bars |
| C — larger map | 24×24 | 28 | 672×672 | More room, smaller cells |

**Recommendation: Option B (20×20 at 32px)**
- Gives the path generator more room to wind without feeling cramped
- 32px cells still show pixelated enemies clearly
- Canvas grows by ~64px vertically — the existing `fitToScreen` scale logic handles this
- Phones: the existing `gameScale` letterbox approach already shrinks to fit,
  so a ~10% canvas growth costs ~10% in effective touch target size.
  Keep the bottom bar button height at 55px minimum; it will still be finger-friendly
  down to ~360px-wide screens at a scale of ~0.55.

Changes needed for a grid resize:
- `GRID_SIZE`, `CELL_SIZE`, `CANVAS_WIDTH/HEIGHT` in `config.ts`
- `NEXUS_X/Y` recalculate automatically from `floor(GRID_SIZE/2)`
- Remove hard-coded `PATH` array entirely (replaced by generator)
- Re-tune `enemySpatialHash` cell size if `CELL_SIZE` changes (keep at ~2× cell px)

---

### 2.7 Implementation Checklist

**Types & Config**
- [ ] Add `TileType`, `Tile`, `MapData` interfaces to `types.ts`
- [ ] Remove `PATH` constant and `getPathCells()` from `config.ts`
- [ ] Add `GRID_SIZE = 20`, `CELL_SIZE = 32` (or confirm Option A/C with team)
- [ ] Recalculate `CANVAS_WIDTH/HEIGHT` from new constants

**Map Generator**
- [ ] Create `src/MapGenerator.ts` with `generateMap(seed?: number): MapData`
- [ ] Implement nexus placement + foundation ring
- [ ] Implement drunk-walk sand path carver
- [ ] Implement water cluster scatter
- [ ] Fill remaining cells with stone
- [ ] Implement connectivity validator (flood fill)
- [ ] Implement center-line waypoint extractor
- [ ] Add retry loop (up to 10 seeds) on validation failure
- [ ] Export `MapData` from generator

**Game Integration**
- [ ] Call `generateMap()` in `GameECS` constructor, store as `this.map: MapData`
- [ ] Store `this.map.tiles` on `ECSWorld` (add `tiles` field); pass to systems that need terrain checks
- [ ] Call `world.setWorldPath(this.map.path)` instead of the old `this.worldPath` assignment
- [ ] Remove `this.pathCells` usage from `GameECS` (replaced by `this.map.tiles`)
- [ ] Update `GameECS.drawGrid()` to render per-tile colors + stone bevel + water shimmer
- [ ] Update `canPlaceEmitter()` in `GameECS` to check `this.map.tiles[gy][gx] === 'foundation'`
- [ ] Add stone tile check in `ecs/systems/movement.ts → updateProjectileMovement()`
- [ ] Add stone push-out in `ecs/systems/movement.ts → updateEnemyMovement()`
- [ ] Add water terrain pass in `ecs/systems/movement.ts` (or new `ecs/systems/terrain.ts`)
- [ ] Update `world.spawnEnemy()` call in `GameECS` to start from `this.map.path[0]`
- [ ] Detect water-drown deaths in `GameECS` death loop; call `world.spawnDeathExplosion()` with blue tint

**Visual**
- [ ] Stone bevel shading in `drawGrid()`
- [ ] Water shimmer animation in `drawGrid()` (tie to `nexusPulse` timer)
- [ ] Foundation tile subtle texture (small cross-hatch or corner dots)

**Scaling**
- [ ] Verify `fitToScreen` / `gameScale` logic still letterboxes correctly at new canvas size
- [ ] Test bottom bar touch targets at 360px phone width
- [ ] Adjust spatial hash cell size in `ECSWorld` constructor (currently hardcoded `64`) if `CELL_SIZE` changed

---

## Feature 3: Game Speed Control

### Vision
Let players accelerate the game clock with `+` and slow back down with `-`.
Three discrete steps for now — fast enough to skip slow early waves, slow enough
to keep decisions readable. The speed multiplier applies uniformly to every `dt`
value that flows through the ECS update loop, so all systems (movement, DOT,
targeting, projectiles, death particles) scale together automatically.

---

### 3.1 Speed Steps

| Step | Multiplier | Display |
|------|-----------|---------|
| Normal | `1.00×` | `▶` |
| Fast | `1.25×` | `▶▶` |
| Max | `1.50×` | `▶▶▶` |

Pressing `+` (or `=` on keyboards without numpad) cycles **up**.
Pressing `-` cycles **down**. Wraps at both ends (max → max, normal → normal, no wrap-around).

---

### 3.2 Implementation

**State**
Add to `GameECS` (and `Game` for legacy compatibility):
```typescript
speedSteps: number[] = [1.0, 1.25, 1.5];
speedIndex: number = 0;
get gameSpeed(): number { return this.speedSteps[this.speedIndex]; }
```

**`update(dt: number)`**
Multiply incoming `dt` before passing it to any system:
```typescript
update(rawDt: number) {
    const dt = rawDt * this.gameSpeed;
    // ... rest of update as normal
}
```
`rawDt` is the real elapsed time from the PixiJS ticker.
Capping `dt` before multiplication (already done to prevent death spiral on tab focus)
should use the raw value: `const dt = Math.min(rawDt, 0.05) * this.gameSpeed`.

**Key handling** — add to `onKeyDown()` in `GameECS`:
```typescript
if (e.key === '+' || e.key === '=') {
    this.speedIndex = Math.min(this.speedIndex + 1, this.speedSteps.length - 1);
}
if (e.key === '-') {
    this.speedIndex = Math.max(this.speedIndex - 1, 0);
}
```

**UI indicator** — add a small speed label to the top bar beside the pause text:
```typescript
// In updateUI():
const icons = ['▶', '▶▶', '▶▶▶'];
this.speedText.text = icons[this.speedIndex];
```
Reuse the existing monospace `TextStyle`. Color it `#aaffaa` when > 1×, white at 1×.

---

### 3.3 Implementation Checklist

- [ ] Add `speedSteps` array and `speedIndex` to `GameECS` (and `Game`)
- [ ] Multiply `dt` by `gameSpeed` at top of `update()`, before any system call
- [ ] Respect existing `dt` cap (`Math.min(rawDt, 0.05)`) on the raw value before scaling
- [ ] Add `+`/`=` and `-` key handling in `onKeyDown()`
- [ ] Add `speedText: Text` to top bar UI (beside pause indicator)
- [ ] Update `speedText` in `updateUI()` with icon + color change
- [ ] Verify auto-wave timer uses scaled `dt` (it's inside `update()`, so it should automatically)
- [ ] Verify chain effect timers, death particle timers, puddle timers all use `dt` (they do)
- [ ] Quick smoke test: set to 1.5× during a wave, confirm enemies, projectiles, DOT all scale correctly

---

## Optional Notes

1. **Foundation size** — 9×9 block centered on the nexus (4-cell deep ring in every
   direction). All 80 surrounding cells are `foundation`; only they accept turrets.
   No outpost foundations elsewhere on the map for now.

2. **Path count** — single spawn point, single guaranteed path. The corridor-carve
   walk's no-revisit rule ensures there are no branches and exactly one route from
   spawn to nexus. Multi-entrance can be revisited as a later feature if desired.

3. **Sell refund** — 25% of total investment. `totalInvestment` is tracked on
   `EmitterData` and accumulates the base placement cost plus every upgrade cost
   actually paid. Refund = `floor(totalInvestment * 0.25)`. This means a fully
   upgraded turret returns more gold than a fresh one, but still at a steep loss
   to discourage frivolous selling.

4. **Water visuals** — dynamic Graphics shimmer (CPU draw each frame tied to the
   existing `nexusPulse` timer). Simple scrolling lighter-band across water cells.
   Good enough for the expected water cell count; revisit if performance dips.
