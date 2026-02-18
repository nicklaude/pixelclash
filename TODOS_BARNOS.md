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

Add `inspectPanel: Container | null = null` to `Game`.

On `selectEmitter(id)`:
1. Destroy old panel if any
2. Build a new `Container` with a `Graphics` background + `Text` nodes for each stat
3. Position it beside the selected cell (clamp to canvas bounds)
4. Add Upgrade and Sell buttons with `pointertap` listeners
5. Re-build the panel on `upgradeEmitter()` so stats refresh immediately

Panel should be added to `uiLayer` so it renders above all game objects.

---

### 1.5 Implementation Checklist

- [ ] Add `rangeGraphics: Graphics` to `Game`, insert into `effectLayer`
- [ ] Draw range ring in `selectEmitter()`, clear in deselect
- [ ] Create `buildInspectPanel(emitter: Emitter): Container` helper in `Game`
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
- In `updateOptimizedProjectiles()`, after moving a projectile, check if its
  grid cell is `stone`. If yes, remove the projectile immediately (no hit effect).

**Projectile vs. water**
- Water tiles are transparent to projectiles — no check needed, they pass freely.

**Enemy vs. stone**
- Path generator guarantees enemies never route through stone.
- If knockback pushes an enemy into a stone cell, clamp its position back to
  the nearest non-stone cell (simple AABB push-out).

**Enemy vs. water (drowning)**
- Each frame, if enemy center lands on a water tile:
  - If `def.size < 10` (small): apply rapid DOT (`300 damage/sec`) and spawn
    splash particles. Enemy despawns when health hits 0 or on a 1-second timer.
  - If `def.size >= 10` (large): apply strong deceleration (multiply velocity
    by `0.5` each frame while on water), enemy cannot be pushed deeper in.

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
- [ ] Call `generateMap()` in `Game` constructor, store as `this.map: MapData`
- [ ] Replace `this.pathCells` / `this.worldPath` with `this.map` references
- [ ] Update `Game.drawGrid()` to render per-tile colors + stone bevel + water shimmer
- [ ] Update `canPlaceEmitter()` to check `tile === 'foundation'`
- [ ] Update projectile update: despawn on `stone` tile hit
- [ ] Update enemy update: push-out from stone cells on knockback
- [ ] Update enemy update: apply water drowning logic (small vs. large)
- [ ] Update `spawnEnemy()` to start from `MapData.path[0]` (generated spawn point)
- [ ] Add splash particle burst on water-drown despawn

**Visual**
- [ ] Stone bevel shading in `drawGrid()`
- [ ] Water shimmer animation in `drawGrid()` (tie to `nexusPulse` timer)
- [ ] Foundation tile subtle texture (small cross-hatch or corner dots)

**Scaling**
- [ ] Verify `fitToScreen` / `gameScale` logic still letterboxes correctly at new canvas size
- [ ] Test bottom bar touch targets at 360px phone width
- [ ] Adjust `enemySpatialHash` cell size constant if `CELL_SIZE` changed

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
