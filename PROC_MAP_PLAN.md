# Procedural Map System - Comprehensive Design Plan

## Executive Summary

This document presents a redesigned procedural map generation system for PixelClash that addresses the fundamental problems with the previous drunk-walk implementation while creating tactically interesting, visually readable maps that support engaging tower defense gameplay.

**Previous System Problems:**
1. Drunk-walk created unpredictable, messy paths that were hard to read and defend
2. Path length varied wildly, breaking difficulty balance
3. Foundation placement (9x9 ring) had no relationship to the generated path
4. No meaningful tactical choices - just random layouts
5. Path could feel cramped or overly winding

**New System Goals:**
- Predictable path structure with controlled variation
- Tactical depth through strategic chokepoints and coverage zones
- Foundation placement that relates to path geometry
- Consistent path length for balanced difficulty
- Visual clarity - players should immediately understand the map

---

## Part 1: Chosen Algorithm - Controlled Spiral with Tactical Zones

### Why Controlled Spiral?

After evaluating multiple approaches, a **Controlled Spiral** algorithm best fits PixelClash:

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Drunk-walk** | High variation | Unpredictable, messy, inconsistent length | **Rejected** - Previous failure |
| **Template-based** | Consistent quality | Limited variety, feels repetitive | Good fallback |
| **Bezier curves** | Smooth paths | Hard to discretize to grid, floaty | Too complex |
| **Room-and-corridor** | Interesting spaces | Wrong genre (roguelike feel) | Wrong aesthetic |
| **Constraint-based** | Mathematically sound | Slow, may fail to converge | Overkill |
| **Controlled Spiral** | Readable, consistent length, good turret placement | Slightly less random | **Chosen** |

### Algorithm Overview

The Controlled Spiral algorithm generates paths that:
1. Always spiral inward from an edge toward the nexus (predictable macro structure)
2. Use controlled "jitter" at corners to create variation (micro randomness)
3. Guarantee consistent path length (3-4 full spiral layers)
4. Create natural chokepoints at spiral corners
5. Generate foundation zones that relate to path geometry

```
Conceptual Map Layout (16x16):

    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5
  +--------------------------------+
 0|S=========================>.    |  S = Spawn
 1|.                         V     |  = = Sand path
 2|.  .===================<. V     |  . = Grass
 3|.  V                   . V     |  F = Foundation
 4|.  V  .FFFFFFFFFFFFF.  . V     |  N = Nexus
 5|.  V  .F           F.  . V     |  ~ = Water
 6|.  V  .F     N     F.  . V     |  # = Stone wall
 7|.  V  .F           F.  . V     |
 8|.  V  .F    ===    F.  . V     |  Path spirals inward
 9|.  V  .FFFFFFFFFFFFF.  . V     |  from spawn to nexus
10|.  V  .                . V     |
11|.  V  .~~ ============>. V     |  Foundation ring
12|.  V  .~~              . V     |  surrounds nexus
13|.  >==. ##             . V     |
14|.      ##              . V     |  Water pools and
15|.  <====================<.     |  stone walls add
  +--------------------------------+  tactical variety
```

---

## Part 2: Tile Types and Their Roles

### 2.1 Complete Tile Type Table

| Tile | ID | Color | Purpose | Enemy | Projectile | Turret |
|------|----|-------|---------|-------|------------|--------|
| **Sand** | 0 | `0xc8a96e` | Path - enemies follow this | Walk | Blocked | No |
| **Stone** | 1 | `0x667788` | Obstacle - blocks projectiles | Impassable | **Blocked** | No |
| **Water** | 2 | `0x2255aa` | Hazard - drowns light enemies | Drown/Slow | Pass | No |
| **Nexus** | 3 | `0x4488ff` | Goal - enemies damage this | End point | - | No |
| **Foundation** | 4 | `0x4a4a3a` | Buildable - turret placement | Cannot walk | Blocked | **Yes** |
| **Grass** | 5 | `0x3a5c2a` | Open terrain - visual fill | Walk (knockback) | Pass | No |

### 2.2 Tactical Interactions

**Stone Walls - Projectile Shadows:**
- 2-4 short stone walls (3-5 cells each) placed strategically
- Create "shadow zones" where certain turret positions cannot shoot
- Players must consider wall placement when choosing foundation cells
- Turrets may target through walls, but projectiles terminate on contact

**Water Pools - Knockback Hazards:**
- 3-5 small pools (3-5 cells each) placed in grass areas
- Light enemies (grunt, fast) take 300 DPS when knocked into water
- Heavy enemies (tank, boss) experience strong drag but survive
- Rewards turrets with knockback (Water Cannon, Sniper)

**Foundation Ring - Strategic Placement:**
- No longer an arbitrary 9x9 ring
- Generated based on path geometry
- Cells closer to chokepoints = higher DPS potential
- Cells farther from path = more coverage but less focus

---

## Part 3: Controlled Spiral Algorithm

### 3.1 Generation Steps

```typescript
interface GeneratorConfig {
    gridSize: number;           // 16 (current) or 20 (recommended)
    cellSize: number;           // 36 (current) or 32 (for 20x20)
    foundationDepth: number;    // How deep foundation extends (4 = 9x9)
    waterPoolCount: [number, number];  // Min/max pools [3, 5]
    stoneWallCount: [number, number];  // Min/max walls [2, 4]
    cornerJitter: number;       // Max jitter at corners (0-2 cells)
    seed?: number;
}
```

#### Step 1: Initialize Grid
```
- Fill entire grid with GRASS
- Place NEXUS at center
- Mark spawn point (random edge)
```

#### Step 2: Generate Spiral Skeleton
```
Algorithm: Layer-by-layer perimeter traversal with corner jitter

For layer = 0 to maxLayers:
    1. Compute layer boundary (inset from previous layer by 1)
    2. For each of 4 edges (top, right, bottom, left):
        a. Compute corner positions with jitter offset
        b. Add waypoints for this edge segment
    3. Stop when layer would enter foundation zone

Jitter rules:
- At each corner, shift turn point by random(0, cornerJitter) cells
- Clamp to prevent crossing previous layer or exiting grid
- Ensures no two maps are identical while maintaining spiral structure
```

#### Step 3: Carve Sand Path
```
For each consecutive waypoint pair:
    1. Walk from A to B on grid
    2. Mark each cell as SAND
    3. Mark one perpendicular neighbor as SAND (2-cell-wide path)
    4. At corners, fill diagonal to prevent gaps
```

#### Step 4: Generate Foundation Zone
```
Novel approach: Foundation follows path, not arbitrary ring

1. Identify all sand path cells
2. For each path cell, mark valid foundation candidates:
   - Cells 2-4 cells perpendicular to path direction
   - Not on path, not on water, not on nexus
3. Add a "core" foundation ring around nexus (3x3 or 5x5)
4. Validate minimum foundation count (60+ cells)
```

#### Step 5: Place Water Pools
```
For each pool:
    1. Pick random seed point in grass (away from path)
    2. Flood-fill grow to 3-5 cells
    3. Verify minimum distance from other pools (4+ cells)
    4. Verify no intersection with path or foundation
```

#### Step 6: Place Stone Walls
```
For each wall:
    1. Choose orientation (horizontal or vertical)
    2. Choose length (3-5 cells)
    3. Find valid placement:
       - In grass between path and foundation
       - Creates projectile shadow on path segment
       - Does not block path connectivity
    4. Validate with ray-cast check
```

#### Step 7: Validate and Finalize
```
Validation checks:
    1. Path connectivity: flood-fill from spawn reaches nexus
    2. Foundation count >= 60
    3. At least 50% of path visible from some foundation cell
    4. No orphaned grass regions (all grass reachable)

If validation fails: increment seed, regenerate (max 10 retries)
```

### 3.2 Path Quality Guarantees

| Property | Guarantee | How |
|----------|-----------|-----|
| Path length | 3.5-4.5 spiral layers | Layer count determined by grid size |
| Connectivity | Always connected | Validation step with retry |
| Chokepoints | 4-8 per map | One at each spiral corner |
| Path width | 2 cells minimum | Explicit 2-cell carving |
| Foundation access | 60+ cells | Validation with retry |

---

## Part 4: Foundation Placement Strategy

### 4.1 Path-Relative Foundation Zones

Instead of an arbitrary ring, foundation cells are generated based on their relationship to the path:

```
Foundation Tiers:

Tier A - Premium (closest to chokepoints):
  - 2 cells from corner turns
  - High DPS potential
  - Limited coverage angle
  - 8-12 cells per map

Tier B - Standard (along straight sections):
  - 2-3 cells from path
  - Balanced DPS and coverage
  - Good for most turrets
  - 30-40 cells per map

Tier C - Distant (farther from path):
  - 3-4 cells from path
  - Maximum coverage
  - Lower focused DPS
  - 20-30 cells per map
```

### 4.2 Tactical Implications

**Close Foundations (Tier A):**
- Best for: Fire (short range, high DPS), Electric (chain needs clusters)
- Worst for: Sniper (overkill range), Splash (self-damage risk)

**Standard Foundations (Tier B):**
- Best for: Water (good knockback angles), Goo (puddle placement)
- Balanced option for all turret types

**Distant Foundations (Tier C):**
- Best for: Sniper (uses full range), Splash (safe distance)
- Worst for: Fire (out of range)

---

## Part 5: Visual Design

### 5.1 Tile Rendering

```typescript
const TILE_COLORS = {
    [TILE_SAND]:       0xc8a96e,  // Warm sandy brown
    [TILE_STONE]:      0x667788,  // Cool slate grey
    [TILE_WATER]:      0x2255aa,  // Deep blue
    [TILE_NEXUS]:      0x4488ff,  // Bright blue (with pulse)
    [TILE_FOUNDATION]: 0x4a4a3a,  // Dark olive
    [TILE_GRASS]:      0x3a5c2a,  // Forest green
};

// Visual effects per tile type:
// Stone: 2px bevel on bottom/right edges (depth illusion)
// Water: Animated shimmer band (scrolling alpha pattern)
// Grass: Checkerboard tint variation (alternating shades)
// Foundation: Corner dots (placement indicator)
// Sand: Flat color (clean path visibility)
```

### 5.2 Future Theme Support

The system is designed to support multiple themes by swapping color palettes:

| Tile | Default | Desert | Winter | Forest |
|------|---------|--------|--------|--------|
| Sand | `0xc8a96e` | `0xd4a45a` | `0xe8e8f0` | `0x8b7355` |
| Stone | `0x667788` | `0x887766` | `0x9999aa` | `0x556644` |
| Water | `0x2255aa` | `0x3366aa` | `0x88aacc` | `0x224488` |
| Grass | `0x3a5c2a` | `0xa08840` | `0xccddcc` | `0x2a4a1a` |

---

## Part 6: ECS Integration

### 6.1 Required Changes to ECSWorld

```typescript
// Add to ECSWorld class:
class ECSWorld {
    // Existing properties...

    // New map properties
    map: MapData | null = null;

    setMap(map: MapData): void {
        this.map = map;
        this.worldPath = map.path;
    }

    getTileAt(gx: number, gy: number): number {
        if (!this.map) return TILE_STONE;
        if (gx < 0 || gx >= this.map.width || gy < 0 || gy >= this.map.height) {
            return TILE_STONE;
        }
        return this.map.tiles[gy * this.map.width + gx];
    }

    isFoundation(gx: number, gy: number): boolean {
        return this.getTileAt(gx, gy) === TILE_FOUNDATION;
    }
}
```

### 6.2 Movement System Updates

```typescript
// In updateProjectileMovement():
// After updating position, check for stone collision
const gx = Math.floor(p.x[i] / CELL_SIZE);
const gy = Math.floor((p.y[i] - UI_TOP_HEIGHT) / CELL_SIZE);
if (world.getTileAt(gx, gy) === TILE_STONE) {
    // Mark projectile for removal
    p.pierce[i] = 0;
}

// In updateEnemyMovement():
// Water drowning check
const tile = world.getTileAt(gx, gy);
if (tile === TILE_WATER) {
    const isHeavy = (e.flags[i] & EF_HEAVY) !== 0;
    if (!isHeavy) {
        // Light enemy: rapid DOT
        e.health[i] -= 300 * dt;
        e.flags[i] |= EF_DIRTY | EF_HEALTH_DIRTY;
    } else {
        // Heavy enemy: drag
        e.vx[i] *= 0.5;
        e.vy[i] *= 0.5;
    }
}
```

### 6.3 GameECS Integration

```typescript
// In GameECS constructor:
constructor(app: Application) {
    // ...existing setup...

    // Generate map
    const map = generateMap({ gridSize: GRID_SIZE, seed: Date.now() });
    this.world.setMap(map);

    // Use map data instead of PATH constant
    this.worldPath = map.path;
    this.foundationCells = new Set(
        map.foundationCells.map(c => `${c.x},${c.y}`)
    );

    // ...rest of setup...
}

// Update canPlaceEmitter:
canPlaceEmitter(gx: number, gy: number): boolean {
    const tile = this.world.getTileAt(gx, gy);
    if (tile !== TILE_FOUNDATION) return false;
    return !this.occupiedCells.has(`${gx},${gy}`);
}
```

---

## Part 7: Implementation Phases

### Phase 1: Core Generator (Effort: 6-8 hours)

**Goal:** Generate valid spiral maps with sand paths and foundation zones.

**Tasks:**
- [ ] Create `src/MapGenerator.ts` with seeded PRNG
- [ ] Implement spiral skeleton generator with corner jitter
- [ ] Implement 2-cell-wide path carving
- [ ] Implement path-relative foundation placement
- [ ] Implement connectivity validation
- [ ] Add retry logic for failed seeds
- [ ] Write unit tests for generator

**Deliverable:** `generateMap()` produces valid `MapData` objects.

---

### Phase 2: Terrain Features (Effort: 4-6 hours)

**Goal:** Add water pools and stone walls with proper validation.

**Tasks:**
- [ ] Implement water pool flood-fill placement
- [ ] Implement stone wall segment placement
- [ ] Add ray-cast validation for wall shadow effectiveness
- [ ] Ensure walls don't block path connectivity
- [ ] Ensure pools don't overlap with critical areas
- [ ] Add minimum distance constraints between features

**Deliverable:** Maps include tactical water and stone features.

---

### Phase 3: Game Integration (Effort: 4-6 hours)

**Goal:** Wire generator into GameECS and ECSWorld.

**Tasks:**
- [ ] Add `map` property and `setMap()` to ECSWorld
- [ ] Add `getTileAt()` helper method
- [ ] Update `GameECS` constructor to use generated map
- [ ] Update `canPlaceEmitter()` for foundation lookup
- [ ] Update enemy spawn to use `map.spawnPoint`
- [ ] Remove old `PATH` constant and `getPathCells()` usage

**Deliverable:** Game runs with generated maps instead of fixed spiral.

---

### Phase 4: Terrain Interactions (Effort: 4-5 hours)

**Goal:** Implement gameplay rules for all tile types.

**Tasks:**
- [ ] Add projectile-stone collision in movement system
- [ ] Add enemy-water drowning/drag in movement system
- [ ] Add enemy-stone push-out on knockback
- [ ] Add blue-tinted death explosion for water deaths
- [ ] Add splash particle effect for water

**Deliverable:** All tile types affect gameplay as specified.

---

### Phase 5: Visual Polish (Effort: 3-4 hours)

**Goal:** Render tiles with proper visual effects.

**Tasks:**
- [ ] Update `drawGrid()` for per-tile rendering
- [ ] Add stone bevel effect
- [ ] Add water shimmer animation
- [ ] Add grass checkerboard tint
- [ ] Add foundation corner dots
- [ ] Test rendering performance

**Deliverable:** Maps look polished and readable.

---

### Phase 6: Testing and Balance (Effort: 4-6 hours)

**Goal:** Ensure maps are fun and balanced.

**Tasks:**
- [ ] Generate 50+ maps, manually review for quality
- [ ] Verify path length consistency across seeds
- [ ] Verify foundation placement creates tactical choices
- [ ] Test water drowning effectiveness
- [ ] Test stone wall projectile blocking
- [ ] Profile generation time (target: <100ms)
- [ ] Add seed display for bug reports/sharing

**Deliverable:** Reliable, balanced map generation.

---

## Part 8: Technical Decisions

### 8.1 Grid Size Recommendation

| Option | Grid | Cell px | Game Area | Analysis |
|--------|------|---------|-----------|----------|
| Current | 16x16 | 36px | 576x576 | Tight; 3 spiral layers max |
| **Recommended** | 20x20 | 32px | 640x640 | Balanced; 4 spiral layers |
| Large | 24x24 | 28px | 672x672 | Small cells; may hurt readability |

**Recommendation: Stay at 16x16 initially** to minimize risk, with the generator designed to scale to 20x20 later.

### 8.2 Performance Considerations

- Generator runs once at game start; target <100ms
- Tile lookups are O(1) array access
- No pathfinding needed (enemies follow pre-computed waypoints)
- Spatial hash updates unchanged
- Rendering is simple fill rectangles (no sprites)

### 8.3 Save/Load Considerations

Maps are deterministic from seed. To save a game:
1. Save the seed value
2. On load, regenerate from seed
3. Map will be identical

---

## Part 9: Estimated Total Effort

| Phase | Hours | Dependencies |
|-------|-------|--------------|
| Phase 1: Core Generator | 6-8 | None |
| Phase 2: Terrain Features | 4-6 | Phase 1 |
| Phase 3: Game Integration | 4-6 | Phase 1 |
| Phase 4: Terrain Interactions | 4-5 | Phase 3 |
| Phase 5: Visual Polish | 3-4 | Phase 3 |
| Phase 6: Testing/Balance | 4-6 | All above |
| **Total** | **25-35** | |

**Recommended implementation order:** 1 -> 2 -> 3 -> 4 -> 5 -> 6

Phases 4 and 5 can be parallelized after Phase 3.

---

## Part 10: Success Criteria

A successful implementation will achieve:

1. **Readability:** Players immediately understand path layout on first glance
2. **Consistency:** Path length varies by <20% across seeds
3. **Tactical Depth:** Stone walls create 2-4 meaningful "shadow zones"
4. **Knockback Value:** Water pools reward knockback-focused builds
5. **Foundation Choice:** Players consider position when placing turrets
6. **Performance:** Generation completes in <100ms
7. **Stability:** No crashes or infinite loops across 1000+ seeds
8. **Visual Quality:** Maps look polished, not procedurally generated

---

## Appendix A: Rejected Alternatives

### Why Not Pure Random?

Pure random placement (scatter sand cells, hope they connect) fails because:
- No guarantee of connectivity
- No control over path length
- No chokepoints or tactical structure
- Maps often look like noise

### Why Not A* Pathfinding?

A* could find optimal paths, but:
- "Optimal" paths are boring (shortest distance)
- Need artificial obstacles to create interesting paths
- Adds complexity without benefit
- Spirals are inherently interesting for TD

### Why Not Pre-Made Templates?

Templates work but:
- Limited variety (players see same maps)
- High art asset burden
- No "surprise" factor
- Procedural approach scales better

---

## Appendix B: Future Enhancements

After the core system is stable, consider:

1. **Multiple Spawn Points:** 2-3 paths converging on nexus
2. **Themed Maps:** Different tile palettes (desert, winter, forest)
3. **Difficulty Scaling:** Harder seeds have shorter paths, less foundation
4. **Map Preview:** Show minimap before game starts
5. **Seed Sharing:** Let players share interesting seeds
6. **Editor Mode:** Manual map creation for custom challenges

---

*Document version: 1.0*
*Created: 2026-02-18*
*Author: Claude (for Sam's review)*
