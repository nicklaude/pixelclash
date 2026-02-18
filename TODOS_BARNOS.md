# PixelClash — Next Feature Roadmap

---

## ✓ Feature 1: Turret Inspection Panel — COMPLETE

### Vision
Clicking a placed turret opens a stat panel with live stats, attack range ring,
and Upgrade / Sell buttons.

### 1.5 Implementation Checklist

- [x] Add `rangeGraphics: Graphics` to `GameECS`, insert into `effectLayer`
- [x] Draw range ring in `selectEmitter()`, clear on deselect
- [x] Create `buildInspectPanel(emitter: Emitter): Container` helper in `GameECS`
- [x] Render all stats (DMG, RNG, RPS, KNK, Pierce, Special) with computed multipliers
- [x] Add Upgrade button → calls `upgradeEmitter()` then rebuilds panel
- [x] Track `totalInvestment` on `EmitterData` — base cost + every upgrade cost paid
- [x] Add Sell button → calls `deleteEmitter()`, refund = `floor(totalInvestment * 0.25)`
- [x] Clamp panel X/Y so it never clips outside canvas bounds
- [x] Destroy panel when clicking empty cell or pressing Escape

---

## Feature 2: Procedural Tile Map

### Vision
Replace the hard-coded spiral `PATH` with a generated tile grid each game.

The map is **mostly open space** — grass covers the majority of the grid, giving
it the feel of an open field. Through that field runs a single narrow sand path
(2 cells wide) that spirals around the full perimeter of the map, hugging the outer
edges layer by layer before finally winding inward to the nexus. Players should be
able to look at the map and clearly see the winding dirt road cutting through open
ground — not a maze, not corridors, just one long spiral trail.

Scattered across the open grass are **small water pools** (3–5 cells each) that
create environmental hazards for lighter enemies knocked off the path. Separately,
**2–4 deliberate stone walls** (short linear segments of 3–5 cells) are placed
throughout the grass to create projectile shadows — areas of the path where turrets
on the foundation cannot shoot cleanly. These walls are the primary tactical element:
players need to consider which foundation cells have clear sightlines vs. which are
partly blocked when deciding where to build.

---

### 2.1 Tile Types

| Tile | ID | Constant | Color (approx) | Enemy | Projectile | Turret |
|------|----|----------|----------------|-------|------------|--------|
| **Sand** | 0 | `TILE_SAND` | `0xc8a96e` | walk (path) | blocked | no |
| **Stone** | 1 | `TILE_STONE` | `0x667788` | impassable | **blocked** | no |
| **Water** | 2 | `TILE_WATER` | `0x2255aa` | drown if small* | pass over | no |
| **Nexus** | 3 | `TILE_NEXUS` | (existing glow) | end point | — | no |
| **Foundation** | 4 | `TILE_FOUNDATION` | `0x4a4a3a` | cannot walk | blocked | **yes** |
| **Grass** | 5 | `TILE_GRASS` | `0x3a5c2a` | walk freely | pass over | no |

*Small enemy drown threshold: enemies with `EF_HEAVY` flag **not** set (grunt, fast)
can be knocked into water. On entry they take rapid DOT (300 dmg/sec) and despawn
via normal death path with a blue-tinted splash explosion. Heavy enemies (tank,
shielded, splitter, boss) are decelerated strongly on water but cannot be drowned.

**Stone blocking note:** Projectiles are killed when they enter a stone cell.
This happens in the movement system regardless of what the turret was targeting —
turrets may still aim at enemies through stone, but projectiles will terminate on
impact. This is intentional for now; line-of-sight targeting can be added later.

---

### 2.2 Types Already in `types.ts`

The following are **already implemented** — do not re-add:

```typescript
// Already exists:
export type TileType = 'sand' | 'stone' | 'water' | 'nexus' | 'foundation';
export const TILE_SAND = 0;
export const TILE_STONE = 1;
export const TILE_WATER = 2;
export const TILE_NEXUS = 3;
export const TILE_FOUNDATION = 4;

export interface MapData {
    tiles: Uint8Array;       // Flattened [y * width + x], values are TILE_* constants
    width: number;
    height: number;
    path: Vec2[];            // World-space waypoints for enemy movement
    foundationCells: Vec2[]; // Grid coords of valid turret cells
    nexus: Vec2;             // Grid coords of nexus center
    spawnPoint: Vec2;        // Grid coords of enemy spawn
}

// Already on EmitterData:
totalInvestment: number;
```

**Still needed — add to `types.ts`:**
```typescript
// Add grass to tile type union:
export type TileType = 'sand' | 'stone' | 'water' | 'nexus' | 'foundation' | 'grass';
export const TILE_GRASS = 5;
```

---

### 2.3 Generator Algorithm (`src/MapGenerator.ts`)

The generator produces a different spiral-leaning map each run via a seeded PRNG.
The map stays at the current **16×16 grid, 36px cells** — no resize needed.

---

#### Step 1 — Seed and PRNG

Use a lightweight seeded LCG for reproducibility:
```typescript
function makePrng(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
```
`generateMap(seed = Date.now())` → deterministic output for any given seed.

---

#### Step 2 — Place nexus and foundation ring

- Nexus at `{ x: floor(GRID_SIZE/2), y: floor(GRID_SIZE/2) }` = `(8, 8)` on a 16×16 grid
- Mark a **9×9 block** (cells within ±4 of nexus) as `TILE_FOUNDATION`
  - 80 foundation cells + 1 nexus cell = 81 total reserved cells
  - On 16×16, this spans (4,4)→(12,12), leaving a 4-cell margin at each edge for the path

---

#### Step 3 — Generate spiral waypoints

Build a **full-perimeter spiral** layer by layer, then add a small random offset at
each corner turn to create variation between games.

**Core idea — layer-by-layer perimeter traversal:**

The spiral works exactly like wrapping a single thread around a box, progressively
tighter:
```
Layer 0 (outermost):
  (0,0) → (15,0)   top edge, left to right
  (15,0) → (15,15) right edge, top to bottom
  (15,15) → (0,15) bottom edge, right to left
  (0,15) → (0,1)   left edge, bottom to top (almost back to start, 1 row in)

Layer 1:
  (1,1) → (14,1)   one cell inward from outer top
  (14,1) → (14,14) one cell inward from outer right
  (14,14) → (1,14) one cell inward from outer bottom
  (1,14) → (1,2)   one cell inward from outer left

Layer 2:
  (2,2) → (13,2)   ...continues inward
  ...

Stop when the next inner corner would land inside or adjacent to the foundation ring.
Append one final segment from the last spiral point to the nearest foundation perimeter cell.
```

**Randomization — corner jitter:**

At each of the 4 corner turns per layer, deviate the turn point by `rand(-jitter, +jitter)`
cells along the travel axis. This shifts where each leg ends and the next begins without
changing the overall spiral structure:
```
jitter = rand(0, 2) per corner  // 0–2 cells of offset
```
Jitter is clamped so the turn point never:
- Crosses into the previous layer's corridor (would create an overlap)
- Goes outside the grid boundary
- Gets closer than `foundationRadius + 1` to the nexus

**Spawn point:**
Pick which of the 4 outer corners to start from randomly: top-left, top-right,
bottom-left, or bottom-right. The direction order (right/down/left/up) rotates
accordingly so the spiral always winds inward clockwise.

**Result:** Every game produces a recognizably spiral map — the same satisfying
winding path structure — but with slightly different corner positions, making no
two maps identical while keeping the layout readable.

---

#### Step 4 — Carve sand path

Walk each waypoint segment and mark cells as `TILE_SAND`:
- Carve **2 cells wide**: the centerline cell plus one perpendicular neighbor
  (prefer the neighbor that is interior to the spiral, not outward)
- At corners (segment transitions), fill the corner cell to avoid diagonal gaps

---

#### Step 5 — Grow water pools

Generate **3–6 small water pools** scattered throughout the open grass areas of the map.
Pools are deliberately small — they're environmental hazards, not large barriers.

**Placement:**
1. Pick 3–6 seed points distributed across the whole grid (not just near the path).
   Divide the map into quadrants and place at least one pool seed per quadrant for
   even spread. Seeds must be on grass (not sand, foundation, or nexus).
2. Minimum distance between any two pool seeds: 4 cells (prevents merging into one blob)

**Growth:**
From each seed, flood-fill grow to a target size of **3–5 cells** (small by design):
- Each growth step adds one random eligible adjacent cell (4-directional, not diagonal)
- Eligible: not sand, not foundation, not nexus, not already water
- Stop when pool reaches target size or no eligible neighbors remain
- The small target size naturally produces compact, roundish pools rather than tendrils

**Result:** 3–6 small ponds scattered across the open field. Enemies knocked hard off the
path have a chance of landing in one. They are visible hazards the player sees but does
not directly control — purely an interaction with the knockback system.

---

#### Step 6 — Place stone walls

Stone walls are the primary tactical feature of the map. They are **deliberate linear
obstacles** — not random scatter — placed to create projectile shadow zones: areas of
the sand path that are shielded from certain firing angles on the foundation.

**What a wall does tactically:**
A wall segment sitting between the foundation and a stretch of path means turrets on
the "shadow side" of the foundation cannot shoot at that path section. Players must
place turrets on the correct foundation cells to have clear sightlines, and must
decide whether a blocked angle is worth working around or compensating for.

**Wall generation:**
1. Generate **2–4 wall segments** per map
2. Each wall is a **straight line of 3–5 cells**, either fully horizontal or fully vertical
3. After all sand, water, and foundation tiles are placed, attempt to place each wall:
   - Choose a random orientation (H or V) and length (3–5)
   - Choose a random anchor cell in the grass region between the path and foundation
   - Verify all cells in the segment are currently grass
   - Verify the wall does not:
     - Touch any sand cell (walls must not sit directly on the path edge)
     - Touch any foundation cell (walls must not directly abut the turret zone)
     - Create a gap narrower than 2 cells between itself and the sand path
       (enemies knocked into the gap shouldn't get permanently stuck)
   - If valid, mark all segment cells as `TILE_STONE`
   - If invalid, try up to 10 random positions before skipping this wall

**Expected outcome:** 2–4 short walls scattered in the open grass. Each creates one or
two foundation cells that lose a clear firing angle on a specific stretch of path.
The map remains mostly open — walls are features, not a maze.

---

#### Step 7 — Fill remaining cells with grass

All cells not yet assigned `TILE_SAND`, `TILE_STONE`, `TILE_WATER`,
`TILE_NEXUS`, or `TILE_FOUNDATION` → `TILE_GRASS`.

Grass is the dominant non-path surface — the map should feel like a grassy
field with a winding dirt road and scattered water features.

---

#### Step 8 — Validate and extract

**Validation:**
- Flood-fill from `spawnPoint` along sand tiles only; must reach the nexus tile
- Confirm `foundationCells.length >= 80`
- If either fails, increment seed by 1 and regenerate (max 10 retries)

**Waypoint extraction:**
- The spiral waypoint list from Step 3 is used directly as `MapData.path`
- Convert grid coords to world-pixel coords: `{ x: gx * CELL_SIZE + CELL_SIZE/2, y: gy * CELL_SIZE + CELL_SIZE/2 + UI_TOP_HEIGHT }`
- Store as `MapData.path`; enemies follow this path via the existing path-following system in `movement.ts`

---

### 2.4 Tile Rendering (`GameECS.drawGrid()`)

Replace `pathCells`-based coloring with per-tile lookup from the flat `Uint8Array`:

```typescript
// Lookup: tile = map.tiles[y * map.width + x]
const TILE_COLORS = [
    0xc8a96e,  // 0 SAND       — warm sandy brown
    0x667788,  // 1 STONE      — cool slate grey
    0x2255aa,  // 2 WATER      — deep blue
    0x1a3366,  // 3 NEXUS      — dark blue (overdrawn by pulse)
    0x4a4a3a,  // 4 FOUNDATION — dark olive
    0x3a5c2a,  // 5 GRASS      — dark green
];
```

**Per-tile visual touches (all in the same drawGrid pass, no extra layers):**
- **Stone**: draw cell slightly darker on bottom and right edges (2px bevel) to imply depth
- **Water**: animated shimmer — draw a lighter horizontal band at `y + offset` where
  `offset = floor(nexusPulse * 8) % CELL_SIZE`; alpha ~0.25; redrawn each frame
- **Grass**: subtle checkerboard tint — alternate between `0x3a5c2a` and `0x324f25`
  based on `(x + y) % 2` (same technique as current non-path tiles)
- **Foundation**: small corner dots (2×2px at each corner) in a slightly lighter shade
  to indicate valid placement zones
- **Sand**: flat color only; path is visually distinct enough without extra treatment

---

### 2.5 Gameplay Rule Changes

**Turret placement**
- `canPlaceEmitter()` changes: use `map.tiles[gy * map.width + gx] === TILE_FOUNDATION`
- Remove the current `pathCells.has(key)` and `NEXUS_X/Y` checks — the tile type
  already encodes all of that information

**Projectile vs. stone — movement system**
- In `ecs/systems/movement.ts → updateProjectileMovement()`, after updating position,
  compute the current grid cell: `gx = floor(x / CELL_SIZE)`, `gy = floor((y - UI_TOP_HEIGHT) / CELL_SIZE)`
- Look up `tiles[gy * width + gx]`; if `TILE_STONE`, mark the projectile inactive
- The tile grid must be passed into the system: add `tiles: Uint8Array` and `mapWidth: number`
  to `ECSWorld`, or pass as extra parameters from `GameECS.update()`
- Given projectile speeds (200–800 px/s) and a 36px cell size, max travel per frame
  at 60 fps is ~13px — less than half a cell — so single-cell-per-frame checking
  is sufficient without ray marching

**Projectile vs. water and grass**
- Both are pass-through — no check needed

**Enemy vs. stone**
- Under normal path following, enemies never enter stone (path generator guarantees this)
- Under knockback: in `updateEnemyMovement()`, after applying velocity, compute the new
  grid cell. If `TILE_STONE`, reverse the velocity component that caused the intrusion
  and revert position on that axis (simple axis-aligned push-out)

**Enemy vs. water (drowning)**
- In `updateEnemyMovement()` (or a new `ecs/systems/terrain.ts`), each frame:
  - Compute enemy grid cell from `(x, y)`
  - If `TILE_WATER`:
    - Light enemies (`EF_HEAVY` not set): call `world.applyDOT(i, 300, 1)`
    - Heavy enemies (`EF_HEAVY` set): multiply `vx`/`vy` by `0.5` (strong drag)
- Water-drown death: in `GameECS` death-processing loop, if a killed enemy's current
  tile was water, call `world.spawnDeathExplosion()` with a blue-tinted override color

**Enemy vs. grass**
- Fully passable, no interaction

---

### 2.6 Map Size

Grid stays at **16×16, 36px cells** for now. The 9×9 foundation ring fits with a
4-cell margin at every edge, which is enough for the spiral path to make 3–4 inward
passes before reaching the foundation. No canvas resize or scaling changes needed.

If a larger grid is wanted later, the foundation ring and spiral generator both
scale automatically with `GRID_SIZE`.

---

### 2.7 Implementation Checklist

**Types & Config**
- [x] `TileType` union, `TILE_*` constants, and `MapData` interface in `types.ts`
- [x] `totalInvestment` on `EmitterData` in `types.ts`
- [ ] Add `'grass'` to `TileType` union and `TILE_GRASS = 5` constant in `types.ts`
- [ ] Keep `PATH` and `getPathCells()` in `config.ts` until generator is wired up; remove afterward

**Map Generator**
- [ ] Create `src/MapGenerator.ts` with `generateMap(seed?: number): MapData`
- [ ] Implement seeded LCG PRNG
- [ ] Implement nexus placement + 9×9 foundation ring
- [ ] Implement spiral waypoint skeleton with per-leg jitter
- [ ] Carve 2-cell-wide sand corridor along waypoints
- [ ] Grow small water pools via flood-fill (3–6 pools, 3–5 cells each, distributed across quadrants)
- [ ] Place stone wall segments (2–4 walls, 3–5 cells long, linear H/V, placement validation enforced)
- [ ] Fill remaining cells with grass
- [ ] Implement connectivity validator (flood-fill from spawn along sand to nexus)
- [ ] Implement retry loop (up to 10 seeds on validation failure)
- [ ] Convert waypoints to world-pixel `Vec2[]` for `MapData.path`
- [ ] Export `generateMap` from `src/MapGenerator.ts`

**Game Integration**
- [ ] Call `generateMap()` in `GameECS` constructor, store as `this.map: MapData`
- [ ] Store `this.map.tiles` and `this.map.width` on `ECSWorld` for system access
- [ ] Call `world.setWorldPath(this.map.path)` instead of the old `this.worldPath` assignment
- [ ] Remove `this.pathCells` Set and `getPathCells()` usage from `GameECS`
- [ ] Update `canPlaceEmitter()` to use flat Uint8Array tile lookup (`TILE_FOUNDATION`)
- [ ] Remove `this.occupiedCells` nexus guard (nexus is now a tile type)
- [ ] Update `GameECS.drawGrid()` to use `TILE_COLORS` array and flat tile lookup
- [ ] Add stone tile kill in `ecs/systems/movement.ts → updateProjectileMovement()`
- [ ] Add stone push-out in `ecs/systems/movement.ts → updateEnemyMovement()`
- [ ] Add water/grass terrain pass in movement system (DOT for light, drag for heavy on water; no-op on grass)
- [ ] Update enemy spawn to use `this.map.spawnPoint` world coords
- [ ] Detect water-drown deaths in `GameECS` death loop → blue-tinted explosion

**Visual (in `drawGrid()`)**
- [ ] Stone bevel (darker bottom/right 2px strip)
- [ ] Water shimmer (scrolling lighter band, alpha 0.25, driven by `nexusPulse`)
- [ ] Grass checkerboard tint (alternating `0x3a5c2a` / `0x324f25`)
- [ ] Foundation corner dots

**Scaling**
- [ ] Verify no hardcoded references to old `PATH` or `pathCells` remain after wiring
- [ ] Smoke test: multiple seeds, confirm connectivity validator passes and maps look varied

---

## Feature 3: Game Speed Control

### Vision
Let players accelerate the game clock with `+`/`=` and slow back down with `-`.
Three discrete steps applied as a `dt` multiplier — all ECS systems scale
automatically because they all consume `dt`.

**Note:** The existing settings menu already has `spawnRateMultiplier` and
`autoWaveDelay` sliders, but these only affect wave timing, not the actual
simulation speed. Feature 3 is a separate, simpler control: a single multiplier
applied at the top of `update()` that speeds up everything — enemies, projectiles,
DOT, knockback, chain effects, puddles, auto-wave timer, all of it.

---

### 3.1 Speed Steps

| Step | Multiplier | Display |
|------|-----------|---------|
| Normal | `1.00×` | `▶` |
| Fast | `1.25×` | `▶▶` |
| Max | `1.50×` | `▶▶▶` |

Pressing `+` or `=` cycles up. Pressing `-` cycles down. Clamps at both ends (no wrap).

---

### 3.2 Implementation

```typescript
// State on GameECS:
speedSteps: number[] = [1.0, 1.25, 1.5];
speedIndex: number = 0;
get gameSpeed(): number { return this.speedSteps[this.speedIndex]; }

// Top of update():
const dt = Math.min(rawDt, 0.05) * this.gameSpeed;

// In onKeyDown():
if (e.key === '+' || e.key === '=')
    this.speedIndex = Math.min(this.speedIndex + 1, this.speedSteps.length - 1);
if (e.key === '-')
    this.speedIndex = Math.max(this.speedIndex - 1, 0);

// In updateUI():
const icons = ['▶', '▶▶', '▶▶▶'];
this.speedText.text = icons[this.speedIndex];  // green tint when > 1×
```

---

### 3.3 Implementation Checklist

- [ ] Add `speedSteps`, `speedIndex`, `gameSpeed` getter to `GameECS`
- [ ] Apply `Math.min(rawDt, 0.05) * this.gameSpeed` at top of `update()`
- [ ] Add `+`/`=` and `-` key handling in `onKeyDown()`
- [ ] Add `speedText: Text` to top bar UI (beside existing pause indicator)
- [ ] Update `speedText` in `updateUI()` — green tint at > 1×, white at 1×
- [ ] Smoke test: confirm all systems scale together at 1.5×

---

## Decisions & Notes

1. **Foundation size** — 9×9 block (±4 from nexus center). 80 foundation cells;
   only they accept turrets. No scattered outpost foundations elsewhere.

2. **Path shape** — Spiral-leaning: the generator builds pre-planned edge-hugging
   waypoints layer by layer (like the current hardcoded PATH) with small per-leg
   jitter. Single spawn point, single connected route guaranteed by validator.

3. **Tile distribution philosophy** — Grass is the dominant surface. Sand is the
   path. Water is coherent pools (flood-fill grown, not random scatter). Stone is
   sparse and small. The map should look like a winding dirt road through a grassy
   field with ponds, not a dungeon.

4. **Sell refund** — 25% of `totalInvestment` (base cost + all upgrades paid).
   Already implemented; `getSellValue()` exists on `Emitter`.

5. **Water visuals** — Dynamic Graphics shimmer driven by `nexusPulse` timer.
   Simple and sufficient for the expected pool count.

6. **Stone projectile blocking** — Per-frame cell check in the movement system is
   sufficient given speeds vs. cell size. Turrets do not yet do line-of-sight checks
   when targeting — they may aim through stone. Projectiles will still terminate on
   contact. LOS targeting can be added as a future improvement.
