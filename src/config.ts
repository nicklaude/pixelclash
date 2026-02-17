import { TowerDef, EnemyDef, PathNode, WaveDef } from './types';

// Grid size
export const GRID_SIZE = 20; // 20x20 grid
export const CELL_SIZE = 2;  // world units per cell
export const GRID_OFFSET = -(GRID_SIZE * CELL_SIZE) / 2; // center the grid

// Nexus position (center of grid)
export const NEXUS_X = Math.floor(GRID_SIZE / 2);
export const NEXUS_Z = Math.floor(GRID_SIZE / 2);

// Path: square ring road around the grid, enemies enter from one corner
// Path goes around the outer ring and spirals inward toward the nexus
export const PATH: PathNode[] = [
    // Enter from top-left, go clockwise around outer ring
    { x: 0, z: 0 },
    { x: 19, z: 0 },   // across top
    { x: 19, z: 19 },  // down right
    { x: 1, z: 19 },   // across bottom
    { x: 1, z: 1 },    // up left (inner)
    // Inner ring
    { x: 18, z: 1 },   // across top inner
    { x: 18, z: 18 },  // down right inner
    { x: 2, z: 18 },   // across bottom inner
    { x: 2, z: 2 },    // up left
    // Spiral in more
    { x: 17, z: 2 },
    { x: 17, z: 17 },
    { x: 3, z: 17 },
    { x: 3, z: 3 },
    // Final approach to nexus
    { x: 10, z: 3 },
    { x: 10, z: 10 },  // nexus!
];

// Cells occupied by path (for blocking tower placement)
export function getPathCells(): Set<string> {
    const cells = new Set<string>();
    for (let i = 0; i < PATH.length - 1; i++) {
        const a = PATH[i];
        const b = PATH[i + 1];
        // Walk from a to b
        const dx = Math.sign(b.x - a.x);
        const dz = Math.sign(b.z - a.z);
        let cx = a.x, cz = a.z;
        while (cx !== b.x || cz !== b.z) {
            cells.add(`${cx},${cz}`);
            if (cx !== b.x) cx += dx;
            if (cz !== b.z) cz += dz;
        }
        cells.add(`${b.x},${b.z}`);
    }
    return cells;
}

// Tower definitions
export const TOWER_DEFS: Record<string, TowerDef> = {
    shooter: {
        type: 'shooter',
        cost: 25,
        range: 5,
        damage: 10,
        fireRate: 2,
        color: 0xee7744,
        height: 2,
        description: 'Fast single-target shooter',
    },
    zapper: {
        type: 'zapper',
        cost: 40,
        range: 4,
        damage: 8,
        fireRate: 1.2,
        color: 0x44bbee,
        height: 2.5,
        description: 'Chain lightning, hits multiple',
        chainCount: 3,
    },
    slower: {
        type: 'slower',
        cost: 30,
        range: 4,
        damage: 3,
        fireRate: 1,
        color: 0x77ccff,
        height: 1.5,
        description: 'Slows enemies in range',
        slowFactor: 0.4,
        slowDuration: 2,
    },
    cannon: {
        type: 'cannon',
        cost: 50,
        range: 6,
        damage: 30,
        fireRate: 0.5,
        color: 0xff8844,
        height: 2,
        description: 'Area damage, slow fire rate',
        aoe: 2.5,
    },
};

// Enemy definitions
export const ENEMY_DEFS: Record<string, EnemyDef> = {
    grunt: {
        type: 'grunt',
        health: 30,
        speed: 2.5,
        reward: 5,
        color: 0xcc4444,
        size: 0.7,
        resistances: { bullet: 0, electric: 0, slow: 0, explosive: 0 },
    },
    fast: {
        type: 'fast',
        health: 15,
        speed: 5,
        reward: 7,
        color: 0xcccc44,
        size: 0.5,
        resistances: { bullet: 0, electric: 0.3, slow: -0.3, explosive: 0.5 },
    },
    tank: {
        type: 'tank',
        health: 100,
        speed: 1.2,
        reward: 15,
        color: 0x6644aa,
        size: 1.0,
        resistances: { bullet: 0.3, electric: -0.3, slow: 0.5, explosive: -0.3 },
    },
    shielded: {
        type: 'shielded',
        health: 50,
        speed: 2,
        reward: 10,
        color: 0x44aa66,
        size: 0.8,
        resistances: { bullet: 0.5, electric: -0.5, slow: 0, explosive: 0 },
    },
};

// Wave generator
export function generateWave(waveNum: number): WaveDef {
    const baseCount = 3 + Math.floor(waveNum * 1.5);
    const spawnDelay = Math.max(300, 800 - waveNum * 30);
    const healthScale = 1 + (waveNum - 1) * 0.2;
    const entries: WaveDef['enemies'] = [];

    if (waveNum <= 2) {
        // Early: just grunts
        entries.push({ type: 'grunt', count: baseCount, delay: spawnDelay });
    } else if (waveNum <= 5) {
        // Mix grunts and fast
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.6), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.4), delay: spawnDelay * 0.7 });
    } else if (waveNum <= 10) {
        // Add tanks
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.4), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.3), delay: spawnDelay * 0.7 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.5 });
        entries.push({ type: 'shielded', count: Math.ceil(baseCount * 0.15), delay: spawnDelay });
    } else {
        // Full mix, harder
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.3), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.25), delay: spawnDelay * 0.5 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.25), delay: spawnDelay * 1.5 });
        entries.push({ type: 'shielded', count: Math.ceil(baseCount * 0.2), delay: spawnDelay });
    }

    // Scale enemy health with wave
    // (actual scaling applied at spawn time)

    return {
        enemies: entries,
        reward: 10 + waveNum * 5,
    };
}

// Upgrade costs and multipliers
export function getUpgradeCost(level: number): number {
    return Math.floor(20 * Math.pow(1.6, level));
}

export function getUpgradeMultiplier(level: number): { damage: number; range: number; fireRate: number } {
    return {
        damage: 1 + level * 0.35,
        range: 1 + level * 0.15,
        fireRate: 1 + level * 0.2,
    };
}

export const STARTING_GOLD = 100;
export const STARTING_HEALTH = 20;
export const HEALTH_SCALE = 1; // health per wave scaling
