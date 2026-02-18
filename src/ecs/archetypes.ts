/**
 * Entity Archetypes
 *
 * Archetype definitions provide the base stats and flags for each entity type.
 * When spawning an entity, we copy values from the archetype into the arrays.
 *
 * This is similar to the Clawd simulation's archetype pattern where each particle
 * type has predefined behaviors and properties.
 */

import { EnemyType, ParticleType, EmitterType } from '../types';
import {
    EF_ACTIVE, EF_KNOCKBACKABLE, EF_HEAVY, EF_SPLITTER, EF_SHIELDED, EF_BOSS,
    PF_ACTIVE, PF_PIERCING, PF_DOT, PF_CHAIN, PF_SLOW, PF_PUDDLE,
    TF_ACTIVE, TF_AOE, TF_SLOW, TF_CHAIN,
    ENEMY_TYPE_MAP,
    PROJECTILE_TYPE_MAP,
} from './types';
import { ENEMY_DEFS, EMITTER_DEFS } from '../config';

// ============================================================================
// Enemy Archetype
// ============================================================================

export interface EnemyArchetype {
    type: number;           // Type ID for Uint8Array
    flags: number;          // Flag bitmask
    health: number;
    speed: number;
    mass: number;
    friction: number;
    reward: number;
    color: number;
    size: number;
    splitCount?: number;
}

/**
 * Enemy archetype definitions.
 * Indexed by type ID for fast lookup.
 */
export const ENEMY_ARCHETYPES: EnemyArchetype[] = [];

// Build archetypes from existing ENEMY_DEFS
for (const [typeName, def] of Object.entries(ENEMY_DEFS)) {
    const typeId = ENEMY_TYPE_MAP[typeName as EnemyType];

    // Calculate flags based on enemy type
    let flags = EF_ACTIVE | EF_KNOCKBACKABLE;  // All enemies are active and knockbackable by default

    if (def.mass >= 3) {
        flags |= EF_HEAVY;  // Heavy enemies have reduced knockback
    }

    if (typeName === 'shielded') {
        flags |= EF_SHIELDED;
    }

    if (typeName === 'splitter') {
        flags |= EF_SPLITTER;
    }

    if (typeName === 'boss') {
        flags |= EF_BOSS | EF_HEAVY;
    }

    ENEMY_ARCHETYPES[typeId] = {
        type: typeId,
        flags,
        health: def.health,
        speed: def.speed,
        mass: def.mass,
        friction: def.friction,
        reward: def.reward,
        color: def.color,
        size: def.size,
        splitCount: def.splitCount,
    };
}

// ============================================================================
// Projectile Archetype
// ============================================================================

export interface ProjectileArchetype {
    type: number;           // Type ID
    flags: number;          // Flag bitmask
    damage: number;
    pierce: number;
    speed: number;
    lifespan: number;
    knockbackForce: number;
    color: number;
    size: number;
    // Optional effect properties
    dotDamage?: number;
    dotDuration?: number;
    chainCount?: number;
    slowFactor?: number;
    slowDuration?: number;
    puddleDuration?: number;
}

/**
 * Projectile archetype definitions.
 * Built from emitter definitions.
 */
export const PROJECTILE_ARCHETYPES: ProjectileArchetype[] = [];

for (const [typeName, def] of Object.entries(EMITTER_DEFS)) {
    const typeId = PROJECTILE_TYPE_MAP[typeName as ParticleType];

    // Calculate flags based on projectile type
    let flags = PF_ACTIVE;

    if (def.particlePierce > 1) {
        flags |= PF_PIERCING;
    }

    if (def.dotDamage && def.dotDuration) {
        flags |= PF_DOT;
    }

    if (def.chainCount && def.chainCount > 0) {
        flags |= PF_CHAIN;
    }

    if (def.slowFactor && def.slowDuration) {
        flags |= PF_SLOW;
    }

    if (def.puddleDuration) {
        flags |= PF_PUDDLE;
    }

    PROJECTILE_ARCHETYPES[typeId] = {
        type: typeId,
        flags,
        damage: def.damage,
        pierce: def.particlePierce,
        speed: def.particleSpeed,
        lifespan: def.particleLifespan,
        knockbackForce: def.knockbackForce,
        color: def.color,
        size: 3,  // Base size, increases with level
        dotDamage: def.dotDamage,
        dotDuration: def.dotDuration,
        chainCount: def.chainCount,
        slowFactor: def.slowFactor,
        slowDuration: def.slowDuration,
        puddleDuration: def.puddleDuration,
    };
}

// ============================================================================
// Emitter Archetype
// ============================================================================

export interface EmitterArchetype {
    type: number;
    flags: number;
    cost: number;
    range: number;
    fireRate: number;
    particlesPerShot: number;
    spreadAngle: number;
    projectileType: number;
}

/**
 * Emitter archetype definitions.
 */
export const EMITTER_ARCHETYPES: EmitterArchetype[] = [];

// Emitter type IDs
export const EMITTER_TYPE_WATER = 0;
export const EMITTER_TYPE_FIRE = 1;
export const EMITTER_TYPE_ELECTRIC = 2;
export const EMITTER_TYPE_GOO = 3;
export const EMITTER_TYPE_SNIPER = 4;
export const EMITTER_TYPE_SPLASH = 5;

export const EMITTER_TYPE_MAP: Record<EmitterType, number> = {
    water: EMITTER_TYPE_WATER,
    fire: EMITTER_TYPE_FIRE,
    electric: EMITTER_TYPE_ELECTRIC,
    goo: EMITTER_TYPE_GOO,
    sniper: EMITTER_TYPE_SNIPER,
    splash: EMITTER_TYPE_SPLASH,
};

export const EMITTER_TYPE_REVERSE: EmitterType[] = ['water', 'fire', 'electric', 'goo', 'sniper', 'splash'];

for (const [typeName, def] of Object.entries(EMITTER_DEFS)) {
    const typeId = EMITTER_TYPE_MAP[typeName as EmitterType];

    // Calculate flags
    let flags = TF_ACTIVE;

    if (def.spreadAngle > 0.2) {
        flags |= TF_AOE;
    }

    if (def.slowFactor) {
        flags |= TF_SLOW;
    }

    if (def.chainCount) {
        flags |= TF_CHAIN;
    }

    EMITTER_ARCHETYPES[typeId] = {
        type: typeId,
        flags,
        cost: def.cost,
        range: def.range,
        fireRate: def.fireRate,
        particlesPerShot: def.particlesPerShot,
        spreadAngle: def.spreadAngle,
        projectileType: PROJECTILE_TYPE_MAP[def.type as ParticleType],
    };
}

// ============================================================================
// Precomputed Flag Arrays (for fast lookup without archetype access)
// ============================================================================

/**
 * Precomputed enemy flags by type ID.
 * Use: ENEMY_FLAGS[typeId] to get default flags for an enemy type.
 */
export const ENEMY_FLAGS = new Uint32Array(8);  // 8 enemy types: grunt, fast, tank, shielded, splitter, boss, healer, cloaked
for (let i = 0; i < ENEMY_ARCHETYPES.length; i++) {
    if (ENEMY_ARCHETYPES[i]) {
        ENEMY_FLAGS[i] = ENEMY_ARCHETYPES[i].flags;
    }
}

/**
 * Precomputed projectile flags by type ID.
 */
export const PROJECTILE_FLAGS = new Uint32Array(6);  // 6 projectile types: water, fire, electric, goo, sniper, splash
for (let i = 0; i < PROJECTILE_ARCHETYPES.length; i++) {
    if (PROJECTILE_ARCHETYPES[i]) {
        PROJECTILE_FLAGS[i] = PROJECTILE_ARCHETYPES[i].flags;
    }
}

/**
 * Precomputed emitter flags by type ID.
 */
export const EMITTER_FLAGS = new Uint32Array(6);  // 6 emitter types: water, fire, electric, goo, sniper, splash
for (let i = 0; i < EMITTER_ARCHETYPES.length; i++) {
    if (EMITTER_ARCHETYPES[i]) {
        EMITTER_FLAGS[i] = EMITTER_ARCHETYPES[i].flags;
    }
}
