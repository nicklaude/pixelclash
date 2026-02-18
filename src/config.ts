import { EmitterDef, EnemyDef, PathNode, WaveDef } from './types';

// Grid size (in cells)
export const GRID_SIZE = 16;  // 16x16 grid
export const CELL_SIZE = 36;  // pixels per cell
export const UI_TOP_HEIGHT = 50;
export const UI_BOTTOM_HEIGHT = 80;
export const GAME_WIDTH = GRID_SIZE * CELL_SIZE;
export const GAME_HEIGHT = GRID_SIZE * CELL_SIZE;
export const CANVAS_WIDTH = GAME_WIDTH;
export const CANVAS_HEIGHT = GAME_HEIGHT + UI_TOP_HEIGHT + UI_BOTTOM_HEIGHT;

// Nexus position (center of grid)
export const NEXUS_X = Math.floor(GRID_SIZE / 2);
export const NEXUS_Y = Math.floor(GRID_SIZE / 2);

// Auto-wave timing
export const AUTO_WAVE_DELAY = 2000;  // ms between waves (faster!)

// Path: enemies enter from corner, spiral to nexus (adjusted for 16x16 grid)
export const PATH: PathNode[] = [
    { x: 0, y: 0 },
    { x: 15, y: 0 },
    { x: 15, y: 15 },
    { x: 1, y: 15 },
    { x: 1, y: 1 },
    { x: 14, y: 1 },
    { x: 14, y: 14 },
    { x: 2, y: 14 },
    { x: 2, y: 2 },
    { x: 13, y: 2 },
    { x: 13, y: 13 },
    { x: 3, y: 13 },
    { x: 3, y: 3 },
    { x: 8, y: 3 },
    { x: 8, y: 8 },  // nexus
];

// Cells occupied by path
export function getPathCells(): Set<string> {
    const cells = new Set<string>();
    for (let i = 0; i < PATH.length - 1; i++) {
        const a = PATH[i];
        const b = PATH[i + 1];
        const dx = Math.sign(b.x - a.x);
        const dy = Math.sign(b.y - a.y);
        let cx = a.x, cy = a.y;
        while (cx !== b.x || cy !== b.y) {
            cells.add(`${cx},${cy}`);
            if (cx !== b.x) cx += dx;
            if (cy !== b.y) cy += dy;
        }
        cells.add(`${b.x},${b.y}`);
    }
    return cells;
}

// Emitter (tower) definitions
export const EMITTER_DEFS: Record<string, EmitterDef> = {
    water: {
        type: 'water',
        cost: 30,
        range: 6,
        damage: 4,
        fireRate: 15,           // high volume stream
        color: 0x4488ff,
        particlesPerShot: 3,
        particleSpeed: 400,
        particlePierce: 3,
        particleLifespan: 1.5,
        spreadAngle: 0.15,
        knockbackForce: 120,    // Strong knockback
        description: 'High-volume stream, pushes enemies back',
    },
    fire: {
        type: 'fire',
        cost: 40,
        range: 4,
        damage: 2,
        fireRate: 20,
        color: 0xff6622,
        particlesPerShot: 5,
        particleSpeed: 250,
        particlePierce: 2,
        particleLifespan: 0.8,
        spreadAngle: 0.4,
        knockbackForce: 15,     // Minimal knockback
        description: 'Short range flamethrower, DOT',
        dotDamage: 5,
        dotDuration: 2,
    },
    electric: {
        type: 'electric',
        cost: 50,
        range: 5,
        damage: 12,
        fireRate: 3,
        color: 0xffff44,
        particlesPerShot: 1,
        particleSpeed: 800,
        particlePierce: 1,
        particleLifespan: 0.5,
        spreadAngle: 0,
        knockbackForce: 50,     // Medium knockback
        description: 'Chain lightning arcs between enemies',
        chainCount: 4,
    },
    goo: {
        type: 'goo',
        cost: 35,
        range: 5,
        damage: 3,
        fireRate: 8,
        color: 0x44ff66,
        particlesPerShot: 2,
        particleSpeed: 200,
        particlePierce: 2,
        particleLifespan: 2,
        spreadAngle: 0.25,
        knockbackForce: 8,      // Very low knockback
        description: 'Sticky goo, slows enemies, leaves puddles',
        slowFactor: 0.4,
        slowDuration: 3,
        puddleDuration: 5,
    },
    sniper: {
        type: 'sniper',
        cost: 75,
        range: 10,              // Very long range
        damage: 45,             // High single-target damage
        fireRate: 0.8,          // Slow fire rate
        color: 0x8844cc,        // Purple
        particlesPerShot: 1,
        particleSpeed: 1200,    // Very fast projectile
        particlePierce: 1,      // Single target only
        particleLifespan: 2,
        spreadAngle: 0,         // Perfect accuracy
        knockbackForce: 200,    // Strong knockback on hit
        description: 'Long range, slow fire, high single-target damage',
    },
    splash: {
        type: 'splash',
        cost: 60,
        range: 5,
        damage: 8,              // Base damage
        fireRate: 2,            // Moderate fire rate
        color: 0xff8844,        // Orange
        particlesPerShot: 1,
        particleSpeed: 350,
        particlePierce: 1,
        particleLifespan: 1.5,
        spreadAngle: 0,
        knockbackForce: 40,
        description: 'Area damage explosion on impact',
        splashRadius: 60,       // Splash damage radius in pixels
    },
};

// Enemy definitions - faster gameplay!
export const ENEMY_DEFS: Record<string, EnemyDef> = {
    grunt: {
        type: 'grunt',
        health: 25,
        speed: 130,             // faster!
        reward: 5,
        color: 0xcc4444,
        size: 10,
        mass: 1,
        friction: 0.85,
    },
    fast: {
        type: 'fast',
        health: 12,
        speed: 220,             // zippy!
        reward: 7,
        color: 0xcccc44,
        size: 7,
        mass: 0.5,
        friction: 0.80,
    },
    tank: {
        type: 'tank',
        health: 80,
        speed: 70,
        reward: 15,
        color: 0x6644aa,
        size: 14,
        mass: 4,
        friction: 0.90,
    },
    shielded: {
        type: 'shielded',
        health: 40,
        speed: 100,
        reward: 10,
        color: 0x44aa66,
        size: 11,
        mass: 1.5,
        friction: 0.88,
    },
    splitter: {
        type: 'splitter',
        health: 35,
        speed: 110,
        reward: 12,
        color: 0xff88ff,
        size: 11,
        mass: 1,
        friction: 0.84,
        splitCount: 2,
    },
    boss: {
        type: 'boss',
        health: 300,
        speed: 50,
        reward: 100,
        color: 0x882222,
        size: 20,
        mass: 10,
        friction: 0.93,
        spawnMinions: true,
    },
    healer: {
        type: 'healer',
        health: 30,
        speed: 90,
        reward: 15,
        color: 0x44ff88,        // Green tint
        size: 10,
        mass: 1,
        friction: 0.85,
        healRadius: 80,         // Pixels - heals enemies within this range
        healAmount: 8,          // HP per second
    },
    cloaked: {
        type: 'cloaked',
        health: 20,
        speed: 150,             // Fast
        reward: 12,
        color: 0x666688,        // Grayish purple
        size: 8,
        mass: 0.7,
        friction: 0.82,
        cloaked: true,          // Appears faded/transparent
    },
};

// Wave generator
export function generateWave(waveNum: number): WaveDef {
    const baseCount = 4 + Math.floor(waveNum * 1.5);
    const spawnDelay = Math.max(400, 1000 - waveNum * 40);
    const entries: WaveDef['enemies'] = [];

    if (waveNum <= 2) {
        entries.push({ type: 'grunt', count: baseCount, delay: spawnDelay });
    } else if (waveNum <= 5) {
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.6), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.4), delay: spawnDelay * 0.7 });
    } else if (waveNum <= 8) {
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.35), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.25), delay: spawnDelay * 0.7 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.2), delay: spawnDelay * 1.5 });
        entries.push({ type: 'cloaked', count: Math.ceil(baseCount * 0.2), delay: spawnDelay * 0.6 });
    } else if (waveNum <= 12) {
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.25), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 0.5 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.5 });
        entries.push({ type: 'shielded', count: Math.ceil(baseCount * 0.15), delay: spawnDelay });
        entries.push({ type: 'cloaked', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 0.6 });
        entries.push({ type: 'healer', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.2 });
    } else if (waveNum <= 15) {
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.2), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 0.5 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.5 });
        entries.push({ type: 'shielded', count: Math.ceil(baseCount * 0.1), delay: spawnDelay });
        entries.push({ type: 'splitter', count: Math.ceil(baseCount * 0.15), delay: spawnDelay });
        entries.push({ type: 'cloaked', count: Math.ceil(baseCount * 0.1), delay: spawnDelay * 0.6 });
        entries.push({ type: 'healer', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.2 });
    } else {
        // Boss waves every 5 waves after 15
        if (waveNum % 5 === 0) {
            entries.push({ type: 'boss', count: 1, delay: spawnDelay * 3 });
        }
        entries.push({ type: 'grunt', count: Math.ceil(baseCount * 0.15), delay: spawnDelay });
        entries.push({ type: 'fast', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 0.5 });
        entries.push({ type: 'tank', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.5 });
        entries.push({ type: 'splitter', count: Math.ceil(baseCount * 0.15), delay: spawnDelay });
        entries.push({ type: 'shielded', count: Math.ceil(baseCount * 0.1), delay: spawnDelay });
        entries.push({ type: 'cloaked', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 0.6 });
        entries.push({ type: 'healer', count: Math.ceil(baseCount * 0.15), delay: spawnDelay * 1.2 });
    }

    return {
        enemies: entries,
        reward: 15 + waveNum * 5,
    };
}

// Upgrade costs and multipliers
export function getUpgradeCost(level: number): number {
    return Math.floor(25 * Math.pow(1.5, level));
}

export function getUpgradeMultiplier(level: number): { damage: number; range: number; fireRate: number; knockback: number } {
    return {
        damage: 1 + level * 0.3,
        range: 1 + level * 0.12,
        fireRate: 1 + level * 0.15,
        knockback: 1 + level * 0.2,
    };
}

export const STARTING_GOLD = 200;  // More starting money
export const STARTING_HEALTH = 20;

// Particle physics constants
export const PARTICLE_TRAIL_LENGTH = 8;
export const MAX_PARTICLES = 2000;  // Increased for ECS performance
export const MAX_ENEMIES = 2000;    // Increased for ECS performance

// Physics constants
export const KNOCKBACK_VELOCITY_THRESHOLD = 15;  // Below this, resume path following (lowered so they don't get stuck)
export const KNOCKBACK_FRICTION_FACTOR = 0.03;   // Per-frame velocity reduction multiplier
