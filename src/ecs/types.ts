/**
 * ECS Type Definitions
 *
 * Structure of Arrays (SoA) pattern for cache-friendly data access.
 * All entity data is stored in contiguous typed arrays for optimal performance.
 *
 * Benefits:
 * - Cache-friendly linear memory access
 * - Zero GC pressure in hot paths
 * - SIMD-friendly data layout
 * - Predictable memory usage
 */

import { ParticleType, EnemyType, EmitterType, Vec2 } from '../types';

// ============================================================================
// Constants
// ============================================================================

export const MAX_ENEMIES = 2000;
export const MAX_PROJECTILES = 2000;
export const MAX_EMITTERS = 100;
export const MAX_DEATH_PARTICLES = 1000;

// ============================================================================
// Enemy Flag Bits
// ============================================================================

/** Basic enemy that follows path */
export const EF_ACTIVE = 1 << 0;
/** Can be knocked back by projectiles */
export const EF_KNOCKBACKABLE = 1 << 1;
/** Heavy - reduced knockback effect */
export const EF_HEAVY = 1 << 2;
/** Spawns children on death */
export const EF_SPLITTER = 1 << 3;
/** Has damage reduction (shield) */
export const EF_SHIELDED = 1 << 4;
/** Boss enemy with special behaviors */
export const EF_BOSS = 1 << 5;
/** Currently burning (DOT active) */
export const EF_ON_FIRE = 1 << 6;
/** Currently slowed */
export const EF_SLOWED = 1 << 7;
/** Flash effect active (just took damage) */
export const EF_FLASHING = 1 << 8;
/** Needs visual redraw */
export const EF_DIRTY = 1 << 9;
/** Needs health bar redraw */
export const EF_HEALTH_DIRTY = 1 << 10;

// ============================================================================
// Projectile Flag Bits
// ============================================================================

/** Projectile is active */
export const PF_ACTIVE = 1 << 0;
/** Can hit multiple enemies */
export const PF_PIERCING = 1 << 1;
/** Applies damage over time */
export const PF_DOT = 1 << 2;
/** Chain lightning effect */
export const PF_CHAIN = 1 << 3;
/** Applies slow effect */
export const PF_SLOW = 1 << 4;
/** Creates ground puddle on hit */
export const PF_PUDDLE = 1 << 5;

// ============================================================================
// Emitter Flag Bits
// ============================================================================

/** Emitter is active */
export const TF_ACTIVE = 1 << 0;
/** Area of effect attacks */
export const TF_AOE = 1 << 1;
/** Slowing effect */
export const TF_SLOW = 1 << 2;
/** Chain attacks */
export const TF_CHAIN = 1 << 3;
/** Currently selected by player */
export const TF_SELECTED = 1 << 4;

// ============================================================================
// Enemy Type IDs (for Uint8Array storage)
// ============================================================================

export const ENEMY_TYPE_GRUNT = 0;
export const ENEMY_TYPE_FAST = 1;
export const ENEMY_TYPE_TANK = 2;
export const ENEMY_TYPE_SHIELDED = 3;
export const ENEMY_TYPE_SPLITTER = 4;
export const ENEMY_TYPE_BOSS = 5;

export const ENEMY_TYPE_MAP: Record<EnemyType, number> = {
    grunt: ENEMY_TYPE_GRUNT,
    fast: ENEMY_TYPE_FAST,
    tank: ENEMY_TYPE_TANK,
    shielded: ENEMY_TYPE_SHIELDED,
    splitter: ENEMY_TYPE_SPLITTER,
    boss: ENEMY_TYPE_BOSS,
};

export const ENEMY_TYPE_REVERSE: EnemyType[] = ['grunt', 'fast', 'tank', 'shielded', 'splitter', 'boss'];

// ============================================================================
// Projectile Type IDs
// ============================================================================

export const PROJECTILE_TYPE_WATER = 0;
export const PROJECTILE_TYPE_FIRE = 1;
export const PROJECTILE_TYPE_ELECTRIC = 2;
export const PROJECTILE_TYPE_GOO = 3;

export const PROJECTILE_TYPE_MAP: Record<ParticleType, number> = {
    water: PROJECTILE_TYPE_WATER,
    fire: PROJECTILE_TYPE_FIRE,
    electric: PROJECTILE_TYPE_ELECTRIC,
    goo: PROJECTILE_TYPE_GOO,
};

export const PROJECTILE_TYPE_REVERSE: ParticleType[] = ['water', 'fire', 'electric', 'goo'];

// ============================================================================
// Enemy Arrays (Structure of Arrays)
// ============================================================================

export interface EnemyArrays {
    // Count of active enemies (always use this for iteration bounds)
    count: number;

    // Identity (Uint32 for IDs that may exceed 65535)
    id: Uint32Array;
    type: Uint8Array;
    flags: Uint32Array;

    // Spatial - position and velocity (Float32 for precision)
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;  // Knockback velocity
    vy: Float32Array;

    // Stats
    health: Float32Array;
    maxHealth: Float32Array;
    baseSpeed: Float32Array;
    mass: Float32Array;
    friction: Float32Array;
    reward: Uint16Array;

    // Path following
    pathIndex: Uint16Array;

    // Status effects
    slowTimer: Float32Array;
    slowFactor: Float32Array;
    dotTimer: Float32Array;
    dotDamage: Float32Array;

    // Visual
    flashTimer: Float32Array;
    color: Uint32Array;
    size: Uint8Array;

    // Scale factor (for splitter children)
    scale: Float32Array;

    // Visual variation (procedural) - Phase 5
    seed: Uint16Array;           // Random seed per enemy (0-65535)
    colorVariation: Int8Array;   // Hue shift (-20 to +20)
    sizeVariation: Int8Array;    // Size delta (-15 to +15 percent)
    patternId: Uint8Array;       // Pattern variant (0-4)
    animPhase: Float32Array;     // Animation phase offset
}

// ============================================================================
// Projectile Arrays (Structure of Arrays)
// ============================================================================

export interface ProjectileArrays {
    // Count of active projectiles
    count: number;

    // Identity
    id: Uint32Array;
    type: Uint8Array;
    flags: Uint32Array;
    sourceId: Uint32Array;  // Which emitter fired this

    // Spatial
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;
    vy: Float32Array;

    // Combat
    damage: Float32Array;
    pierce: Uint8Array;
    knockbackForce: Float32Array;
    lifespan: Float32Array;
    maxLifespan: Float32Array;

    // Visual
    color: Uint32Array;
    size: Uint8Array;

    // Hit tracking - sparse Map for sets (doesn't fit well in typed arrays)
    // Key: projectile index, Value: Set of enemy IDs hit
    hitEnemies: Map<number, Set<number>>;
}

// ============================================================================
// Emitter Arrays (Structure of Arrays)
// ============================================================================

export interface EmitterArrays {
    // Count of active emitters
    count: number;

    // Identity
    id: Uint32Array;
    type: Uint8Array;
    flags: Uint32Array;

    // Grid position (fixed after placement)
    gridX: Uint8Array;
    gridY: Uint8Array;

    // World position (computed from grid)
    x: Float32Array;
    y: Float32Array;

    // State
    level: Uint8Array;
    cooldown: Float32Array;
    angle: Float32Array;
    targetIndex: Int32Array;  // -1 = no target, otherwise index into enemy arrays

    // Fire accumulator for consistent fire rate regardless of frame time
    fireAccumulator: Float32Array;
}

// ============================================================================
// Death Particle Arrays (for explosion effects)
// ============================================================================

export interface DeathParticleArrays {
    count: number;

    // Spatial
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;
    vy: Float32Array;

    // Visual
    color: Uint32Array;
    size: Float32Array;
    life: Float32Array;
    maxLife: Float32Array;
}

// ============================================================================
// Collision Event (produced by collision system)
// ============================================================================

export interface CollisionEvent {
    projectileIndex: number;
    enemyIndex: number;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createEnemyArrays(maxCount: number = MAX_ENEMIES): EnemyArrays {
    return {
        count: 0,
        id: new Uint32Array(maxCount),
        type: new Uint8Array(maxCount),
        flags: new Uint32Array(maxCount),
        x: new Float32Array(maxCount),
        y: new Float32Array(maxCount),
        vx: new Float32Array(maxCount),
        vy: new Float32Array(maxCount),
        health: new Float32Array(maxCount),
        maxHealth: new Float32Array(maxCount),
        baseSpeed: new Float32Array(maxCount),
        mass: new Float32Array(maxCount),
        friction: new Float32Array(maxCount),
        reward: new Uint16Array(maxCount),
        pathIndex: new Uint16Array(maxCount),
        slowTimer: new Float32Array(maxCount),
        slowFactor: new Float32Array(maxCount),
        dotTimer: new Float32Array(maxCount),
        dotDamage: new Float32Array(maxCount),
        flashTimer: new Float32Array(maxCount),
        color: new Uint32Array(maxCount),
        size: new Uint8Array(maxCount),
        scale: new Float32Array(maxCount),
        // Visual variation arrays - Phase 5
        seed: new Uint16Array(maxCount),
        colorVariation: new Int8Array(maxCount),
        sizeVariation: new Int8Array(maxCount),
        patternId: new Uint8Array(maxCount),
        animPhase: new Float32Array(maxCount),
    };
}

export function createProjectileArrays(maxCount: number = MAX_PROJECTILES): ProjectileArrays {
    return {
        count: 0,
        id: new Uint32Array(maxCount),
        type: new Uint8Array(maxCount),
        flags: new Uint32Array(maxCount),
        sourceId: new Uint32Array(maxCount),
        x: new Float32Array(maxCount),
        y: new Float32Array(maxCount),
        vx: new Float32Array(maxCount),
        vy: new Float32Array(maxCount),
        damage: new Float32Array(maxCount),
        pierce: new Uint8Array(maxCount),
        knockbackForce: new Float32Array(maxCount),
        lifespan: new Float32Array(maxCount),
        maxLifespan: new Float32Array(maxCount),
        color: new Uint32Array(maxCount),
        size: new Uint8Array(maxCount),
        hitEnemies: new Map(),
    };
}

export function createEmitterArrays(maxCount: number = MAX_EMITTERS): EmitterArrays {
    return {
        count: 0,
        id: new Uint32Array(maxCount),
        type: new Uint8Array(maxCount),
        flags: new Uint32Array(maxCount),
        gridX: new Uint8Array(maxCount),
        gridY: new Uint8Array(maxCount),
        x: new Float32Array(maxCount),
        y: new Float32Array(maxCount),
        level: new Uint8Array(maxCount),
        cooldown: new Float32Array(maxCount),
        angle: new Float32Array(maxCount),
        targetIndex: new Int32Array(maxCount),
        fireAccumulator: new Float32Array(maxCount),
    };
}

export function createDeathParticleArrays(maxCount: number = MAX_DEATH_PARTICLES): DeathParticleArrays {
    return {
        count: 0,
        x: new Float32Array(maxCount),
        y: new Float32Array(maxCount),
        vx: new Float32Array(maxCount),
        vy: new Float32Array(maxCount),
        color: new Uint32Array(maxCount),
        size: new Float32Array(maxCount),
        life: new Float32Array(maxCount),
        maxLife: new Float32Array(maxCount),
    };
}
