/**
 * Procedural Map Generator
 *
 * Generates controlled spiral maps with tactical features for tower defense gameplay.
 *
 * Algorithm: Controlled Spiral with Corner Jitter
 * - Always spirals inward from an edge toward the nexus
 * - Uses controlled "jitter" at corners to create variation
 * - Guarantees consistent path length (3-4 full spiral layers)
 * - Creates natural chokepoints at spiral corners
 * - Generates foundation zones that relate to path geometry
 */

import { Vec2 } from './types';
import { CELL_SIZE, UI_TOP_HEIGHT } from './config';

// ============================================================================
// Tile Type Constants
// ============================================================================

export const TILE_GRASS = 0;      // Open terrain - visual fill, knockback landing
export const TILE_SAND = 1;       // Path - enemies follow this
export const TILE_STONE = 2;      // Obstacle - blocks projectiles
export const TILE_WATER = 3;      // Hazard - drowns light enemies
export const TILE_NEXUS = 4;      // Goal - enemies damage this
export const TILE_FOUNDATION = 5; // Buildable - turret placement

export const TILE_COLORS: Record<number, number> = {
    [TILE_GRASS]: 0x3a5c2a,       // Forest green
    [TILE_SAND]: 0xc8a96e,        // Warm sandy brown
    [TILE_STONE]: 0x667788,       // Cool slate grey
    [TILE_WATER]: 0x2255aa,       // Deep blue
    [TILE_NEXUS]: 0x4488ff,       // Bright blue
    [TILE_FOUNDATION]: 0x4a4a3a,  // Dark olive
};

// Terrain gameplay config
export const TERRAIN_CONFIG = {
    // Water effects
    waterDPS: 200,                // Damage per second for light enemies drowning
    waterLightSlowFactor: 0.3,    // Speed multiplier for light enemies in water
    waterHeavySlowFactor: 0.5,    // Speed multiplier for heavy enemies in water

    // Generation parameters
    minPathDistanceForWater: 2,   // Minimum cells from path for water pools
    minPoolDistance: 4,           // Minimum cells between water pools
    minFoundationCount: 30,       // Minimum foundation cells required
};

// ============================================================================
// Types
// ============================================================================

export interface MapData {
    tiles: Uint8Array;            // Flattened [y * width + x] grid
    width: number;
    height: number;
    path: Vec2[];                 // World-space waypoints for enemy navigation
    foundationCells: Vec2[];      // Valid turret placement cells (grid coords)
    nexus: Vec2;                  // Grid coords of nexus
    spawnPoint: Vec2;             // Grid coords of enemy spawn
    seed: number;                 // Seed used for generation (for replay/debug)
}

export interface GeneratorConfig {
    gridSize: number;             // Grid dimension (16 or 20)
    cellSize: number;             // Pixels per cell
    cornerJitter: number;         // Max jitter at corners (0-2 cells)
    waterPoolCount: [number, number];  // [min, max] water pools
    stoneWallCount: [number, number];  // [min, max] stone walls
    foundationDepth: number;      // How deep foundation extends from path
    seed?: number;                // Random seed (optional)
}

export const DEFAULT_CONFIG: GeneratorConfig = {
    gridSize: 16,
    cellSize: 36,
    cornerJitter: 2,
    waterPoolCount: [2, 4],
    stoneWallCount: [1, 3],
    foundationDepth: 3,
    seed: undefined,
};

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

class SeededRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    // Simple LCG (Linear Congruential Generator)
    next(): number {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return (this.seed >>> 0) / 4294967296;
    }

    // Random integer in range [min, max] inclusive
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    // Random float in range [min, max)
    nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    // Pick random element from array
    pick<T>(arr: T[]): T {
        return arr[Math.floor(this.next() * arr.length)];
    }

    // Shuffle array in place
    shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getTile(tiles: Uint8Array, width: number, x: number, y: number): number {
    if (x < 0 || x >= width || y < 0 || y >= width) return TILE_STONE;
    return tiles[y * width + x];
}

function setTile(tiles: Uint8Array, width: number, x: number, y: number, tile: number): void {
    if (x < 0 || x >= width || y < 0 || y >= width) return;
    tiles[y * width + x] = tile;
}

function inBounds(x: number, y: number, size: number): boolean {
    return x >= 0 && x < size && y >= 0 && y < size;
}

function manhattanDist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

// ============================================================================
// Spiral Path Generation
// ============================================================================

interface SpiralWaypoint {
    x: number;
    y: number;
    isCorner: boolean;
}

/**
 * Generate a clean spiral path from edge to center
 */
function generateCleanSpiral(
    gridSize: number,
    nexusX: number,
    nexusY: number,
    rng: SeededRandom,
    cornerJitter: number
): SpiralWaypoint[] {
    const waypoints: SpiralWaypoint[] = [];

    // Calculate number of spiral layers based on grid size
    // For 16x16 grid with nexus at center (8,8), we can fit ~3-4 layers
    const maxRadius = Math.min(nexusX, nexusY, gridSize - 1 - nexusX, gridSize - 1 - nexusY);
    const numLayers = Math.max(2, Math.floor(maxRadius / 2) - 1);

    // Start from a corner - choose based on RNG
    const corners = [
        { x: 0, y: 0, startDir: 0 },           // Top-left, go right
        { x: gridSize - 1, y: 0, startDir: 1 }, // Top-right, go down
        { x: gridSize - 1, y: gridSize - 1, startDir: 2 }, // Bottom-right, go left
        { x: 0, y: gridSize - 1, startDir: 3 }, // Bottom-left, go up
    ];

    const startCorner = corners[rng.nextInt(0, 3)];

    // Direction vectors: right, down, left, up (clockwise)
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: -1 },
    ];

    let x = startCorner.x;
    let y = startCorner.y;
    let dirIndex = startCorner.startDir;

    waypoints.push({ x, y, isCorner: true });

    // Generate spiral by going around the perimeter, then moving inward
    for (let layer = 0; layer < numLayers; layer++) {
        const inset = layer;
        const minCoord = inset;
        const maxCoord = gridSize - 1 - inset;

        // Go around this layer (4 edges)
        for (let edge = 0; edge < 4; edge++) {
            const dir = dirs[dirIndex % 4];

            // Calculate target for this edge
            let targetX = x;
            let targetY = y;

            if (dir.dx === 1) targetX = maxCoord;      // going right
            else if (dir.dx === -1) targetX = minCoord; // going left
            if (dir.dy === 1) targetY = maxCoord;      // going down
            else if (dir.dy === -1) targetY = minCoord; // going up

            // Apply jitter
            if (cornerJitter > 0 && layer < numLayers - 1) {
                const jitter = rng.nextInt(0, cornerJitter);
                if (dir.dx !== 0) {
                    // Horizontal movement - jitter vertically at the end
                    const jitterDir = rng.next() > 0.5 ? 1 : -1;
                    const jitteredY = y + jitter * jitterDir;
                    if (jitteredY >= minCoord && jitteredY <= maxCoord) {
                        // Add intermediate waypoint for jitter
                        if (targetX !== x) {
                            waypoints.push({ x: targetX, y, isCorner: true });
                        }
                        if (jitteredY !== y) {
                            waypoints.push({ x: targetX, y: jitteredY, isCorner: false });
                            y = jitteredY;
                        }
                        x = targetX;
                    } else {
                        x = targetX;
                        waypoints.push({ x, y, isCorner: true });
                    }
                } else {
                    // Vertical movement - jitter horizontally at the end
                    const jitterDir = rng.next() > 0.5 ? 1 : -1;
                    const jitteredX = x + jitter * jitterDir;
                    if (jitteredX >= minCoord && jitteredX <= maxCoord) {
                        if (targetY !== y) {
                            waypoints.push({ x, y: targetY, isCorner: true });
                        }
                        if (jitteredX !== x) {
                            waypoints.push({ x: jitteredX, y: targetY, isCorner: false });
                            x = jitteredX;
                        }
                        y = targetY;
                    } else {
                        y = targetY;
                        waypoints.push({ x, y, isCorner: true });
                    }
                }
            } else {
                // No jitter - just go to target
                if (targetX !== x || targetY !== y) {
                    x = targetX;
                    y = targetY;
                    waypoints.push({ x, y, isCorner: true });
                }
            }

            dirIndex++;
        }

        // Move to next layer inward
        if (layer < numLayers - 1) {
            // Step inward along current direction
            const dir = dirs[dirIndex % 4];
            const nextInset = layer + 1;

            // Move diagonally to next layer start
            if (dir.dx === 1) { x = nextInset; y = nextInset; }
            else if (dir.dy === 1) { x = gridSize - 1 - nextInset; y = nextInset; }
            else if (dir.dx === -1) { x = gridSize - 1 - nextInset; y = gridSize - 1 - nextInset; }
            else { x = nextInset; y = gridSize - 1 - nextInset; }

            waypoints.push({ x, y, isCorner: true });
        }
    }

    // Connect to nexus
    waypoints.push({ x: nexusX, y: nexusY, isCorner: false });

    return waypoints;
}

// ============================================================================
// Path Carving
// ============================================================================

/**
 * Carve a 2-cell wide sand path along waypoints
 */
function carvePath(
    tiles: Uint8Array,
    gridSize: number,
    waypoints: SpiralWaypoint[]
): Vec2[] {
    const pathCells: Vec2[] = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i];
        const to = waypoints[i + 1];

        // Walk from A to B
        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);

        let x = from.x;
        let y = from.y;

        // Determine which side to expand for 2-cell width (consistent per segment)
        const perpDx = dx !== 0 ? 0 : 1;
        const perpDy = dy !== 0 ? 0 : 1;

        while (x !== to.x || y !== to.y) {
            // Set primary path cell
            setTile(tiles, gridSize, x, y, TILE_SAND);
            pathCells.push({ x, y });

            // Set ONE perpendicular neighbor for consistent 2-cell width
            const nx = x + perpDx;
            const ny = y + perpDy;
            if (inBounds(nx, ny, gridSize)) {
                setTile(tiles, gridSize, nx, ny, TILE_SAND);
            }

            // Move towards target
            if (x !== to.x) x += dx;
            else if (y !== to.y) y += dy;
        }

        // Add final cell
        setTile(tiles, gridSize, to.x, to.y, TILE_SAND);
        pathCells.push({ x: to.x, y: to.y });
    }

    return pathCells;
}

// ============================================================================
// Foundation Placement
// ============================================================================

/**
 * Generate foundation cells based on path geometry
 * Foundations are placed adjacent to the path at varying depths
 */
function generateFoundations(
    tiles: Uint8Array,
    gridSize: number,
    pathCells: Vec2[],
    nexusX: number,
    nexusY: number,
    foundationDepth: number,
    rng: SeededRandom
): Vec2[] {
    const foundations: Vec2[] = [];
    const foundationSet = new Set<string>();

    // Create foundation ring around nexus (3x3)
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const fx = nexusX + dx;
            const fy = nexusY + dy;
            if (inBounds(fx, fy, gridSize) && getTile(tiles, gridSize, fx, fy) === TILE_GRASS) {
                setTile(tiles, gridSize, fx, fy, TILE_FOUNDATION);
                foundations.push({ x: fx, y: fy });
                foundationSet.add(`${fx},${fy}`);
            }
        }
    }

    // Create path-relative foundations
    // For each path cell, check perpendicular cells at various depths
    const pathSet = new Set(pathCells.map(p => `${p.x},${p.y}`));

    for (const pathCell of pathCells) {
        // Check all 4 directions
        const directions = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
        ];

        for (const dir of directions) {
            // Check cells at depths 1 to foundationDepth
            for (let depth = 1; depth <= foundationDepth; depth++) {
                const fx = pathCell.x + dir.dx * depth;
                const fy = pathCell.y + dir.dy * depth;
                const key = `${fx},${fy}`;

                // Skip if out of bounds, already foundation, or is path
                if (!inBounds(fx, fy, gridSize)) continue;
                if (foundationSet.has(key)) continue;
                if (pathSet.has(key)) continue;

                const tile = getTile(tiles, gridSize, fx, fy);
                if (tile !== TILE_GRASS) continue;

                // Probability decreases with depth
                const prob = 1 - (depth - 1) * 0.25;
                if (rng.next() < prob) {
                    setTile(tiles, gridSize, fx, fy, TILE_FOUNDATION);
                    foundations.push({ x: fx, y: fy });
                    foundationSet.add(key);
                }
            }
        }
    }

    return foundations;
}

// ============================================================================
// Terrain Features
// ============================================================================

/**
 * Place water pools in grass areas away from path
 */
function placeWaterPools(
    tiles: Uint8Array,
    gridSize: number,
    pathCells: Vec2[],
    count: number,
    rng: SeededRandom
): void {
    const pathSet = new Set(pathCells.map(p => `${p.x},${p.y}`));
    const waterCells: Vec2[] = [];

    // Find candidate cells (grass, away from path)
    const candidates: Vec2[] = [];
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            if (getTile(tiles, gridSize, x, y) !== TILE_GRASS) continue;

            // Must be at least minPathDistanceForWater cells from path
            let nearPath = false;
            for (const p of pathCells) {
                if (manhattanDist(x, y, p.x, p.y) < TERRAIN_CONFIG.minPathDistanceForWater) {
                    nearPath = true;
                    break;
                }
            }
            if (nearPath) continue;

            candidates.push({ x, y });
        }
    }

    rng.shuffle(candidates);

    // Place pools
    for (let i = 0; i < count && candidates.length > 0; i++) {
        const seed = candidates.pop()!;

        // Check distance from existing water
        let tooClose = false;
        for (const wc of waterCells) {
            if (manhattanDist(seed.x, seed.y, wc.x, wc.y) < TERRAIN_CONFIG.minPoolDistance) {
                tooClose = true;
                break;
            }
        }
        if (tooClose) continue;

        // Flood fill to create pool (3-5 cells)
        const poolSize = rng.nextInt(3, 5);
        const queue: Vec2[] = [seed];
        const visited = new Set<string>();
        let placed = 0;

        while (queue.length > 0 && placed < poolSize) {
            const cell = queue.shift()!;
            const key = `${cell.x},${cell.y}`;
            if (visited.has(key)) continue;
            visited.add(key);

            if (!inBounds(cell.x, cell.y, gridSize)) continue;
            if (getTile(tiles, gridSize, cell.x, cell.y) !== TILE_GRASS) continue;

            setTile(tiles, gridSize, cell.x, cell.y, TILE_WATER);
            waterCells.push(cell);
            placed++;

            // Add neighbors to queue
            const neighbors = [
                { x: cell.x + 1, y: cell.y },
                { x: cell.x - 1, y: cell.y },
                { x: cell.x, y: cell.y + 1 },
                { x: cell.x, y: cell.y - 1 },
            ];
            rng.shuffle(neighbors);
            for (const n of neighbors) {
                queue.push(n);
            }
        }
    }
}

/**
 * Place stone walls that create projectile shadows
 */
function placeStoneWalls(
    tiles: Uint8Array,
    gridSize: number,
    pathCells: Vec2[],
    count: number,
    rng: SeededRandom
): void {
    const pathSet = new Set(pathCells.map(p => `${p.x},${p.y}`));

    for (let i = 0; i < count; i++) {
        // Choose orientation (horizontal or vertical)
        const horizontal = rng.next() > 0.5;

        // Choose length (3-5 cells)
        const length = rng.nextInt(3, 5);

        // Find valid placement (in grass between path and foundation)
        let attempts = 0;
        while (attempts < 50) {
            attempts++;

            const startX = rng.nextInt(1, gridSize - length - 1);
            const startY = rng.nextInt(1, gridSize - length - 1);

            // Check if all cells are grass and not blocking path
            let valid = true;
            const wallCells: Vec2[] = [];

            for (let j = 0; j < length && valid; j++) {
                const wx = horizontal ? startX + j : startX;
                const wy = horizontal ? startY : startY + j;

                if (getTile(tiles, gridSize, wx, wy) !== TILE_GRASS) {
                    valid = false;
                }

                // Check distance from path (at least 1 cell away)
                for (const p of pathCells) {
                    if (manhattanDist(wx, wy, p.x, p.y) < 1) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    wallCells.push({ x: wx, y: wy });
                }
            }

            if (valid && wallCells.length === length) {
                // Place the wall
                for (const cell of wallCells) {
                    setTile(tiles, gridSize, cell.x, cell.y, TILE_STONE);
                }
                break;
            }
        }
    }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that path is fully connected from spawn to nexus
 */
function validatePath(
    tiles: Uint8Array,
    gridSize: number,
    spawnX: number,
    spawnY: number,
    nexusX: number,
    nexusY: number
): boolean {
    // BFS from spawn to nexus
    const visited = new Set<string>();
    const queue: Vec2[] = [{ x: spawnX, y: spawnY }];

    while (queue.length > 0) {
        const cell = queue.shift()!;
        const key = `${cell.x},${cell.y}`;

        if (cell.x === nexusX && cell.y === nexusY) {
            return true;
        }

        if (visited.has(key)) continue;
        visited.add(key);

        // Check neighbors
        const neighbors = [
            { x: cell.x + 1, y: cell.y },
            { x: cell.x - 1, y: cell.y },
            { x: cell.x, y: cell.y + 1 },
            { x: cell.x, y: cell.y - 1 },
        ];

        for (const n of neighbors) {
            if (!inBounds(n.x, n.y, gridSize)) continue;
            const tile = getTile(tiles, gridSize, n.x, n.y);
            if (tile === TILE_SAND || tile === TILE_NEXUS) {
                queue.push(n);
            }
        }
    }

    return false;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a procedural map
 *
 * @param config Generator configuration
 * @returns MapData with all map information
 */
export function generateMap(config: Partial<GeneratorConfig> = {}): MapData {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const seed = cfg.seed ?? Date.now();
    const rng = new SeededRandom(seed);

    const { gridSize, cellSize } = cfg;

    // Initialize grid with grass
    const tiles = new Uint8Array(gridSize * gridSize);
    tiles.fill(TILE_GRASS);

    // Place nexus at center
    const nexusX = Math.floor(gridSize / 2);
    const nexusY = Math.floor(gridSize / 2);
    setTile(tiles, gridSize, nexusX, nexusY, TILE_NEXUS);

    // Generate spiral waypoints
    const waypoints = generateCleanSpiral(gridSize, nexusX, nexusY, rng, cfg.cornerJitter);

    // Carve path
    const pathCells = carvePath(tiles, gridSize, waypoints);

    // Generate foundations
    const foundationCells = generateFoundations(
        tiles, gridSize, pathCells, nexusX, nexusY, cfg.foundationDepth, rng
    );

    // Place water pools
    const waterCount = rng.nextInt(cfg.waterPoolCount[0], cfg.waterPoolCount[1]);
    placeWaterPools(tiles, gridSize, pathCells, waterCount, rng);

    // Place stone walls
    const stoneCount = rng.nextInt(cfg.stoneWallCount[0], cfg.stoneWallCount[1]);
    placeStoneWalls(tiles, gridSize, pathCells, stoneCount, rng);

    // Get spawn point (first waypoint)
    const spawnPoint = { x: waypoints[0].x, y: waypoints[0].y };

    // Validate path connectivity
    if (!validatePath(tiles, gridSize, spawnPoint.x, spawnPoint.y, nexusX, nexusY)) {
        // Retry with different seed (track retry count)
        const retryCount = (cfg as any)._retryCount ?? 0;
        if (retryCount < 10) {
            return generateMap({
                ...cfg,
                seed: seed + 1,
                _retryCount: retryCount + 1
            } as any);
        }
        // If we've tried 10 times, just use what we have
        console.warn('Map validation failed after 10 attempts, using best effort');
    }

    // Ensure minimum foundation count
    if (foundationCells.length < TERRAIN_CONFIG.minFoundationCount) {
        // Add more foundations around nexus
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue; // Skip inner ring
                const fx = nexusX + dx;
                const fy = nexusY + dy;
                if (inBounds(fx, fy, gridSize) && getTile(tiles, gridSize, fx, fy) === TILE_GRASS) {
                    setTile(tiles, gridSize, fx, fy, TILE_FOUNDATION);
                    foundationCells.push({ x: fx, y: fy });
                }
            }
        }
    }

    // Convert waypoints to world-space path for enemy navigation
    const worldPath: Vec2[] = waypoints.map(wp => ({
        x: wp.x * cellSize + cellSize / 2,
        y: wp.y * cellSize + cellSize / 2 + UI_TOP_HEIGHT,
    }));

    return {
        tiles,
        width: gridSize,
        height: gridSize,
        path: worldPath,
        foundationCells,
        nexus: { x: nexusX, y: nexusY },
        spawnPoint,
        seed,
    };
}

/**
 * Check if a cell is on the path
 */
export function isPathCell(map: MapData, gx: number, gy: number): boolean {
    return getTile(map.tiles, map.width, gx, gy) === TILE_SAND;
}

/**
 * Check if a cell is a foundation
 */
export function isFoundationCell(map: MapData, gx: number, gy: number): boolean {
    return getTile(map.tiles, map.width, gx, gy) === TILE_FOUNDATION;
}

/**
 * Get tile type at position
 */
export function getTileAt(map: MapData, gx: number, gy: number): number {
    return getTile(map.tiles, map.width, gx, gy);
}
