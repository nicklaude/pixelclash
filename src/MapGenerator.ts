/**
 * Procedural Map Generator
 *
 * Generates game maps using a drunk-walk algorithm with bias toward the nexus.
 * Creates interesting path layouts with water hazards and foundation zones for turrets.
 *
 * Phase 6 Implementation
 */

import { Vec2, MapData, TILE_SAND, TILE_STONE, TILE_WATER, TILE_NEXUS, TILE_FOUNDATION } from './types';
import { CELL_SIZE, UI_TOP_HEIGHT } from './config';

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

export class SeededRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    /**
     * Returns a random number between 0 and 1
     */
    next(): number {
        // Simple LCG (Linear Congruential Generator)
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    /**
     * Returns a random integer between min and max (inclusive)
     */
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /**
     * Returns a random element from an array
     */
    pick<T>(arr: T[]): T {
        return arr[Math.floor(this.next() * arr.length)];
    }
}

// ============================================================================
// Generator Configuration
// ============================================================================

export interface GeneratorConfig {
    gridSize: number;           // Default 20
    foundationRadius: number;   // Default 4 (9x9 ring around nexus)
    waterClusterCount: number;  // Default 3-5
    seed?: number;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
    gridSize: 20,
    foundationRadius: 4,
    waterClusterCount: 4,
};

// ============================================================================
// Map Generator
// ============================================================================

/**
 * Generate a procedural map
 */
export function generateMap(config: Partial<GeneratorConfig> = {}): MapData {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const rng = new SeededRandom(cfg.seed ?? Date.now());
    const size = cfg.gridSize;

    // Step 1: Initialize all as stone
    const tiles = new Uint8Array(size * size);
    tiles.fill(TILE_STONE);

    // Step 2: Place nexus at center
    const nexus: Vec2 = {
        x: Math.floor(size / 2),
        y: Math.floor(size / 2)
    };
    setTile(tiles, size, nexus.x, nexus.y, TILE_NEXUS);

    // Step 3: Place foundation ring around nexus
    const foundationCells: Vec2[] = [];
    for (let dy = -cfg.foundationRadius; dy <= cfg.foundationRadius; dy++) {
        for (let dx = -cfg.foundationRadius; dx <= cfg.foundationRadius; dx++) {
            if (dx === 0 && dy === 0) continue; // Skip nexus
            const fx = nexus.x + dx;
            const fy = nexus.y + dy;
            if (inBounds(fx, fy, size)) {
                setTile(tiles, size, fx, fy, TILE_FOUNDATION);
                foundationCells.push({ x: fx, y: fy });
            }
        }
    }

    // Step 4: Pick random edge spawn point
    const spawnPoint = pickRandomEdge(rng, size);

    // Step 5: Carve sand path from spawn to nexus using drunk-walk
    const pathCells = carvePath(tiles, size, spawnPoint, nexus, rng, foundationCells);

    // Step 6: Scatter water clusters adjacent to path
    scatterWater(tiles, size, pathCells, rng, cfg.waterClusterCount);

    // Step 7: Validate connectivity
    if (!validatePath(tiles, size, spawnPoint, nexus)) {
        // Retry with different seed
        return generateMap({ ...cfg, seed: (cfg.seed ?? 0) + 1 });
    }

    // Step 8: Extract world-space waypoints from path
    const path = extractWaypoints(pathCells, size);

    return {
        tiles,
        width: size,
        height: size,
        path,
        foundationCells,
        nexus,
        spawnPoint,
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

function setTile(tiles: Uint8Array, width: number, x: number, y: number, type: number): void {
    tiles[y * width + x] = type;
}

function getTile(tiles: Uint8Array, width: number, x: number, y: number): number {
    return tiles[y * width + x];
}

function inBounds(x: number, y: number, size: number): boolean {
    return x >= 0 && x < size && y >= 0 && y < size;
}

/**
 * Pick a random point on the edge of the grid
 */
function pickRandomEdge(rng: SeededRandom, size: number): Vec2 {
    const edge = rng.nextInt(0, 3);
    const pos = rng.nextInt(1, size - 2);

    switch (edge) {
        case 0: return { x: pos, y: 0 };           // Top
        case 1: return { x: size - 1, y: pos };    // Right
        case 2: return { x: pos, y: size - 1 };    // Bottom
        case 3: return { x: 0, y: pos };           // Left
        default: return { x: 0, y: 0 };
    }
}

/**
 * Carve a path from spawn to nexus using drunk-walk algorithm
 * 70% chance: move toward nexus
 * 30% chance: move perpendicular
 */
function carvePath(
    tiles: Uint8Array,
    size: number,
    spawn: Vec2,
    nexus: Vec2,
    rng: SeededRandom,
    foundationCells: Vec2[]
): Vec2[] {
    const path: Vec2[] = [];
    const visited = new Set<string>();
    let current = { ...spawn };
    const foundationSet = new Set(foundationCells.map(c => `${c.x},${c.y}`));

    // Carve spawn point
    setTile(tiles, size, current.x, current.y, TILE_SAND);
    path.push({ ...current });
    visited.add(`${current.x},${current.y}`);

    let maxIterations = size * size * 2;
    let iterations = 0;

    while (iterations++ < maxIterations) {
        // Check if we reached foundation ring (adjacent to nexus area)
        const dx = nexus.x - current.x;
        const dy = nexus.y - current.y;
        const distToNexus = Math.abs(dx) + Math.abs(dy);

        if (distToNexus <= 1) {
            // We're at the nexus
            break;
        }

        // Check if we're in the foundation area
        if (foundationSet.has(`${current.x},${current.y}`)) {
            // Convert this cell to sand (path through foundation)
            setTile(tiles, size, current.x, current.y, TILE_SAND);
            // Remove from foundation list
            const idx = foundationCells.findIndex(c => c.x === current.x && c.y === current.y);
            if (idx >= 0) foundationCells.splice(idx, 1);
            foundationSet.delete(`${current.x},${current.y}`);
        }

        // Calculate next move
        const moves: Vec2[] = [];

        // Bias toward nexus (70%)
        if (rng.next() < 0.7) {
            // Move toward nexus
            if (Math.abs(dx) >= Math.abs(dy)) {
                moves.push({ x: current.x + Math.sign(dx), y: current.y });
            } else {
                moves.push({ x: current.x, y: current.y + Math.sign(dy) });
            }
        } else {
            // Move perpendicular (30%)
            if (Math.abs(dx) >= Math.abs(dy)) {
                // Moving horizontal, add vertical options
                moves.push({ x: current.x, y: current.y + 1 });
                moves.push({ x: current.x, y: current.y - 1 });
            } else {
                // Moving vertical, add horizontal options
                moves.push({ x: current.x + 1, y: current.y });
                moves.push({ x: current.x - 1, y: current.y });
            }
        }

        // Add backup moves (toward nexus)
        if (dx !== 0) moves.push({ x: current.x + Math.sign(dx), y: current.y });
        if (dy !== 0) moves.push({ x: current.x, y: current.y + Math.sign(dy) });

        // Filter valid moves
        const validMoves = moves.filter(m =>
            inBounds(m.x, m.y, size) &&
            !visited.has(`${m.x},${m.y}`) &&
            getTile(tiles, size, m.x, m.y) !== TILE_NEXUS
        );

        if (validMoves.length === 0) {
            // Stuck - try any adjacent unvisited cell
            const allMoves = [
                { x: current.x + 1, y: current.y },
                { x: current.x - 1, y: current.y },
                { x: current.x, y: current.y + 1 },
                { x: current.x, y: current.y - 1 },
            ].filter(m =>
                inBounds(m.x, m.y, size) &&
                !visited.has(`${m.x},${m.y}`) &&
                getTile(tiles, size, m.x, m.y) !== TILE_NEXUS
            );

            if (allMoves.length === 0) {
                // Really stuck - backtrack
                if (path.length > 1) {
                    path.pop();
                    current = { ...path[path.length - 1] };
                    continue;
                } else {
                    break;
                }
            }

            current = rng.pick(allMoves);
        } else {
            current = validMoves[0];
        }

        // Carve the cell
        const tile = getTile(tiles, size, current.x, current.y);
        if (tile !== TILE_NEXUS) {
            setTile(tiles, size, current.x, current.y, TILE_SAND);
        }
        path.push({ ...current });
        visited.add(`${current.x},${current.y}`);
    }

    return path;
}

/**
 * Scatter water clusters adjacent to the path
 */
function scatterWater(
    tiles: Uint8Array,
    size: number,
    pathCells: Vec2[],
    rng: SeededRandom,
    count: number
): void {
    const pathSet = new Set(pathCells.map(c => `${c.x},${c.y}`));

    // Find candidate cells (stone cells adjacent to path)
    const candidates: Vec2[] = [];
    for (const cell of pathCells) {
        const neighbors = [
            { x: cell.x + 1, y: cell.y },
            { x: cell.x - 1, y: cell.y },
            { x: cell.x, y: cell.y + 1 },
            { x: cell.x, y: cell.y - 1 },
        ];
        for (const n of neighbors) {
            if (inBounds(n.x, n.y, size) &&
                getTile(tiles, size, n.x, n.y) === TILE_STONE &&
                !pathSet.has(`${n.x},${n.y}`)) {
                candidates.push(n);
            }
        }
    }

    // Shuffle and pick clusters
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = rng.nextInt(0, i);
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const placed = new Set<string>();
    let clustersPlaced = 0;

    for (const candidate of candidates) {
        if (clustersPlaced >= count) break;
        if (placed.has(`${candidate.x},${candidate.y}`)) continue;

        // Create a small cluster (1-3 cells)
        const clusterSize = rng.nextInt(1, 3);
        let cellsPlaced = 0;
        const queue = [candidate];

        while (queue.length > 0 && cellsPlaced < clusterSize) {
            const cell = queue.shift()!;
            const key = `${cell.x},${cell.y}`;

            if (placed.has(key)) continue;
            if (!inBounds(cell.x, cell.y, size)) continue;
            if (getTile(tiles, size, cell.x, cell.y) !== TILE_STONE) continue;

            setTile(tiles, size, cell.x, cell.y, TILE_WATER);
            placed.add(key);
            cellsPlaced++;

            // Add neighbors to queue
            const neighbors = [
                { x: cell.x + 1, y: cell.y },
                { x: cell.x - 1, y: cell.y },
                { x: cell.x, y: cell.y + 1 },
                { x: cell.x, y: cell.y - 1 },
            ];
            for (const n of neighbors) {
                if (rng.next() < 0.5) {
                    queue.push(n);
                }
            }
        }

        if (cellsPlaced > 0) {
            clustersPlaced++;
        }
    }
}

/**
 * Validate that path connects spawn to nexus using flood fill
 */
function validatePath(
    tiles: Uint8Array,
    size: number,
    spawn: Vec2,
    nexus: Vec2
): boolean {
    const visited = new Set<string>();
    const queue = [spawn];
    visited.add(`${spawn.x},${spawn.y}`);

    while (queue.length > 0) {
        const cell = queue.shift()!;

        // Check if we reached nexus
        if (Math.abs(cell.x - nexus.x) <= 1 && Math.abs(cell.y - nexus.y) <= 1) {
            return true;
        }

        // Check neighbors
        const neighbors = [
            { x: cell.x + 1, y: cell.y },
            { x: cell.x - 1, y: cell.y },
            { x: cell.x, y: cell.y + 1 },
            { x: cell.x, y: cell.y - 1 },
        ];

        for (const n of neighbors) {
            const key = `${n.x},${n.y}`;
            if (visited.has(key)) continue;
            if (!inBounds(n.x, n.y, size)) continue;

            const tile = getTile(tiles, size, n.x, n.y);
            // Can walk on sand, foundation, or nexus
            if (tile === TILE_SAND || tile === TILE_FOUNDATION || tile === TILE_NEXUS) {
                visited.add(key);
                queue.push(n);
            }
        }
    }

    return false;
}

/**
 * Extract world-space waypoints from path cells
 * Simplify path by keeping only corners
 */
function extractWaypoints(pathCells: Vec2[], size: number): Vec2[] {
    if (pathCells.length === 0) return [];

    const waypoints: Vec2[] = [];

    // Always include start
    waypoints.push(gridToWorld(pathCells[0]));

    // Add corners (direction changes)
    for (let i = 1; i < pathCells.length - 1; i++) {
        const prev = pathCells[i - 1];
        const curr = pathCells[i];
        const next = pathCells[i + 1];

        const prevDx = curr.x - prev.x;
        const prevDy = curr.y - prev.y;
        const nextDx = next.x - curr.x;
        const nextDy = next.y - curr.y;

        // Direction changed = corner
        if (prevDx !== nextDx || prevDy !== nextDy) {
            waypoints.push(gridToWorld(curr));
        }
    }

    // Always include end
    if (pathCells.length > 1) {
        waypoints.push(gridToWorld(pathCells[pathCells.length - 1]));
    }

    return waypoints;
}

/**
 * Convert grid coordinates to world coordinates
 */
function gridToWorld(cell: Vec2): Vec2 {
    return {
        x: cell.x * CELL_SIZE + CELL_SIZE / 2,
        y: cell.y * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT,
    };
}

/**
 * Get tile at grid position from map data
 */
export function getTileAt(map: MapData, gx: number, gy: number): number {
    if (gx < 0 || gx >= map.width || gy < 0 || gy >= map.height) {
        return TILE_STONE;
    }
    return map.tiles[gy * map.width + gx];
}
