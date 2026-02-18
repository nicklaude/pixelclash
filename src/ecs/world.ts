/**
 * ECS World
 *
 * The central manager for all ECS data. Contains all typed arrays and provides
 * high-level operations for entity management.
 *
 * Design principles:
 * - All entity data lives in typed arrays for cache-friendly access
 * - Systems operate on raw arrays via pure functions
 * - Rendering syncs ECS data to PixiJS display objects
 * - Minimal GC pressure through array reuse and swap-remove patterns
 */

import { Container, Graphics, Application } from 'pixi.js';
import { Vec2 } from '../types';
import { CELL_SIZE, ENEMY_DEFS, EMITTER_DEFS, KNOCKBACK_VELOCITY_THRESHOLD, getUpgradeMultiplier } from '../config';
import {
    EnemyArrays, ProjectileArrays, EmitterArrays, DeathParticleArrays,
    createEnemyArrays, createProjectileArrays, createEmitterArrays, createDeathParticleArrays,
    EF_ACTIVE, EF_ON_FIRE, EF_SLOWED, EF_FLASHING, EF_DIRTY, EF_HEALTH_DIRTY, EF_SPLITTER, EF_KNOCKBACKABLE,
    PF_ACTIVE, PF_DOT, PF_SLOW, PF_CHAIN, PF_PUDDLE,
    TF_ACTIVE, TF_SELECTED,
    ENEMY_TYPE_MAP, ENEMY_TYPE_REVERSE,
    PROJECTILE_TYPE_MAP, PROJECTILE_TYPE_REVERSE,
    MAX_ENEMIES, MAX_PROJECTILES, MAX_EMITTERS, MAX_DEATH_PARTICLES,
    CollisionEvent,
} from './types';
import {
    ENEMY_ARCHETYPES, PROJECTILE_ARCHETYPES, EMITTER_ARCHETYPES,
    EMITTER_TYPE_MAP, EMITTER_TYPE_REVERSE,
} from './archetypes';

// ============================================================================
// ECS World
// ============================================================================

export class ECSWorld {
    // Entity arrays
    enemies: EnemyArrays;
    projectiles: ProjectileArrays;
    emitters: EmitterArrays;
    deathParticles: DeathParticleArrays;

    // Path data (shared by all enemies)
    worldPath: Vec2[] = [];

    // Next entity ID counter
    private nextId: number = 1;

    // Reusable arrays to avoid per-frame allocations
    private deadEnemyIndices: number[] = [];
    private deadProjectileIndices: number[] = [];
    private deadParticleIndices: number[] = [];
    private collisionEvents: CollisionEvent[] = [];

    // Spatial hash for efficient collision detection
    private enemySpatialCells: Map<number, number[]> = new Map();
    private spatialCellSize: number = 64;

    constructor() {
        this.enemies = createEnemyArrays(MAX_ENEMIES);
        this.projectiles = createProjectileArrays(MAX_PROJECTILES);
        this.emitters = createEmitterArrays(MAX_EMITTERS);
        this.deathParticles = createDeathParticleArrays(MAX_DEATH_PARTICLES);
    }

    /**
     * Set the world path for enemy navigation
     */
    setWorldPath(path: Vec2[]): void {
        this.worldPath = path;
    }

    /**
     * Get next unique entity ID
     */
    getNextId(): number {
        return this.nextId++;
    }

    /**
     * Set the next ID (useful when loading or syncing with game state)
     */
    setNextId(id: number): void {
        this.nextId = id;
    }

    // ========================================================================
    // Enemy Management
    // ========================================================================

    /**
     * Spawn an enemy at a position with optional scale
     */
    spawnEnemy(
        typeName: string,
        x: number,
        y: number,
        waveNum: number,
        scale: number = 1,
        startPathIndex: number = 0
    ): number {
        const e = this.enemies;
        if (e.count >= MAX_ENEMIES) return -1;

        const typeId = ENEMY_TYPE_MAP[typeName as keyof typeof ENEMY_TYPE_MAP];
        const arch = ENEMY_ARCHETYPES[typeId];
        if (!arch) return -1;

        const i = e.count++;
        const id = this.nextId++;

        // Health scales with wave number
        const healthScale = 1 + (waveNum - 1) * 0.2;
        const scaledHealth = Math.round(arch.health * healthScale * scale);

        // Identity
        e.id[i] = id;
        e.type[i] = typeId;
        e.flags[i] = arch.flags | EF_DIRTY | EF_HEALTH_DIRTY;

        // Spatial
        e.x[i] = x;
        e.y[i] = y;
        e.vx[i] = 0;
        e.vy[i] = 0;

        // Stats
        e.health[i] = scaledHealth;
        e.maxHealth[i] = scaledHealth;
        e.baseSpeed[i] = arch.speed * scale;
        e.mass[i] = arch.mass * scale;
        e.friction[i] = arch.friction;
        e.reward[i] = Math.round(arch.reward * scale);

        // Path
        e.pathIndex[i] = startPathIndex;

        // Status effects (none initially)
        e.slowTimer[i] = 0;
        e.slowFactor[i] = 1;
        e.dotTimer[i] = 0;
        e.dotDamage[i] = 0;

        // Visual
        e.flashTimer[i] = 0;
        e.color[i] = arch.color;
        e.size[i] = arch.size;
        e.scale[i] = scale;

        // Visual variation (procedural) - Phase 5
        const seed = (Math.random() * 65535) | 0;
        e.seed[i] = seed;
        // Derive variations from seed using simple hash
        e.colorVariation[i] = ((seed * 7) % 41) - 20;     // -20 to +20
        e.sizeVariation[i] = ((seed * 13) % 31) - 15;     // -15 to +15
        e.patternId[i] = (seed * 3) % 5;                  // 0-4
        e.animPhase[i] = ((seed * 17) % 628) / 100;       // 0 to ~2PI

        // If not spawning at path start, find nearest path index
        if (startPathIndex === 0 && this.worldPath.length > 0) {
            if (x !== this.worldPath[0].x || y !== this.worldPath[0].y) {
                let nearestIdx = 0;
                let nearestDistSq = Infinity;
                for (let j = 0; j < this.worldPath.length; j++) {
                    const dx = this.worldPath[j].x - x;
                    const dy = this.worldPath[j].y - y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                        nearestIdx = j;
                    }
                }
                e.pathIndex[i] = nearestIdx;
            }
        }

        return i;
    }

    /**
     * Remove enemy at index using swap-remove pattern (O(1))
     */
    removeEnemyAt(index: number): void {
        const e = this.enemies;
        if (index >= e.count || index < 0) return;

        const lastIdx = e.count - 1;
        if (index !== lastIdx) {
            // Swap with last element
            e.id[index] = e.id[lastIdx];
            e.type[index] = e.type[lastIdx];
            e.flags[index] = e.flags[lastIdx];
            e.x[index] = e.x[lastIdx];
            e.y[index] = e.y[lastIdx];
            e.vx[index] = e.vx[lastIdx];
            e.vy[index] = e.vy[lastIdx];
            e.health[index] = e.health[lastIdx];
            e.maxHealth[index] = e.maxHealth[lastIdx];
            e.baseSpeed[index] = e.baseSpeed[lastIdx];
            e.mass[index] = e.mass[lastIdx];
            e.friction[index] = e.friction[lastIdx];
            e.reward[index] = e.reward[lastIdx];
            e.pathIndex[index] = e.pathIndex[lastIdx];
            e.slowTimer[index] = e.slowTimer[lastIdx];
            e.slowFactor[index] = e.slowFactor[lastIdx];
            e.dotTimer[index] = e.dotTimer[lastIdx];
            e.dotDamage[index] = e.dotDamage[lastIdx];
            e.flashTimer[index] = e.flashTimer[lastIdx];
            e.color[index] = e.color[lastIdx];
            e.size[index] = e.size[lastIdx];
            e.scale[index] = e.scale[lastIdx];
            // Visual variation arrays - Phase 5
            e.seed[index] = e.seed[lastIdx];
            e.colorVariation[index] = e.colorVariation[lastIdx];
            e.sizeVariation[index] = e.sizeVariation[lastIdx];
            e.patternId[index] = e.patternId[lastIdx];
            e.animPhase[index] = e.animPhase[lastIdx];
        }
        e.count--;
    }

    /**
     * Apply damage to an enemy, returns true if killed
     */
    damageEnemy(index: number, damage: number): boolean {
        const e = this.enemies;
        e.health[index] -= damage;
        e.flashTimer[index] = 0.1;
        e.flags[index] |= EF_FLASHING | EF_DIRTY | EF_HEALTH_DIRTY;
        return e.health[index] <= 0;
    }

    /**
     * Apply knockback to an enemy
     */
    knockbackEnemy(index: number, forceX: number, forceY: number): void {
        const e = this.enemies;
        if (!(e.flags[index] & EF_KNOCKBACKABLE)) return;

        const knockbackMult = 1 / e.mass[index];
        e.vx[index] += forceX * knockbackMult;
        e.vy[index] += forceY * knockbackMult;
    }

    /**
     * Apply DOT (damage over time) effect to an enemy
     */
    applyDOT(index: number, damage: number, duration: number): void {
        const e = this.enemies;
        e.dotTimer[index] = duration;
        e.dotDamage[index] = damage;
        e.flags[index] |= EF_ON_FIRE | EF_DIRTY;
    }

    /**
     * Apply slow effect to an enemy
     */
    applySlow(index: number, factor: number, duration: number): void {
        const e = this.enemies;
        e.slowTimer[index] = duration;
        e.slowFactor[index] = Math.min(e.slowFactor[index], factor);
        e.flags[index] |= EF_SLOWED;
    }

    // ========================================================================
    // Projectile Management
    // ========================================================================

    /**
     * Spawn a projectile
     */
    spawnProjectile(
        typeName: string,
        x: number,
        y: number,
        vx: number,
        vy: number,
        damage: number,
        knockbackForce: number,
        size: number,
        sourceEmitterId: number
    ): number {
        const p = this.projectiles;
        if (p.count >= MAX_PROJECTILES) return -1;

        const typeId = PROJECTILE_TYPE_MAP[typeName as keyof typeof PROJECTILE_TYPE_MAP];
        const arch = PROJECTILE_ARCHETYPES[typeId];
        if (!arch) return -1;

        const i = p.count++;
        const id = this.nextId++;

        // Identity
        p.id[i] = id;
        p.type[i] = typeId;
        p.flags[i] = arch.flags;
        p.sourceId[i] = sourceEmitterId;

        // Spatial
        p.x[i] = x;
        p.y[i] = y;
        p.vx[i] = vx;
        p.vy[i] = vy;

        // Combat
        p.damage[i] = damage;
        p.pierce[i] = arch.pierce;
        p.knockbackForce[i] = knockbackForce;
        p.lifespan[i] = arch.lifespan;
        p.maxLifespan[i] = arch.lifespan;

        // Visual
        p.color[i] = arch.color;
        p.size[i] = size;

        // Initialize hit tracking
        p.hitEnemies.set(i, new Set());

        return i;
    }

    /**
     * Remove projectile at index using swap-remove
     */
    removeProjectileAt(index: number): void {
        const p = this.projectiles;
        if (index >= p.count || index < 0) return;

        // Clear hit enemies set
        p.hitEnemies.delete(index);

        const lastIdx = p.count - 1;
        if (index !== lastIdx) {
            // Swap with last element
            p.id[index] = p.id[lastIdx];
            p.type[index] = p.type[lastIdx];
            p.flags[index] = p.flags[lastIdx];
            p.sourceId[index] = p.sourceId[lastIdx];
            p.x[index] = p.x[lastIdx];
            p.y[index] = p.y[lastIdx];
            p.vx[index] = p.vx[lastIdx];
            p.vy[index] = p.vy[lastIdx];
            p.damage[index] = p.damage[lastIdx];
            p.pierce[index] = p.pierce[lastIdx];
            p.knockbackForce[index] = p.knockbackForce[lastIdx];
            p.lifespan[index] = p.lifespan[lastIdx];
            p.maxLifespan[index] = p.maxLifespan[lastIdx];
            p.color[index] = p.color[lastIdx];
            p.size[index] = p.size[lastIdx];

            // Move hit enemies set
            const lastHitSet = p.hitEnemies.get(lastIdx);
            if (lastHitSet) {
                p.hitEnemies.set(index, lastHitSet);
                p.hitEnemies.delete(lastIdx);
            }
        }
        p.count--;
    }

    /**
     * Check if projectile has hit an enemy
     */
    hasHitEnemy(projectileIndex: number, enemyId: number): boolean {
        const hitSet = this.projectiles.hitEnemies.get(projectileIndex);
        return hitSet ? hitSet.has(enemyId) : false;
    }

    /**
     * Register a hit on an enemy
     */
    registerHit(projectileIndex: number, enemyId: number): void {
        let hitSet = this.projectiles.hitEnemies.get(projectileIndex);
        if (!hitSet) {
            hitSet = new Set();
            this.projectiles.hitEnemies.set(projectileIndex, hitSet);
        }
        hitSet.add(enemyId);
        this.projectiles.pierce[projectileIndex]--;
    }

    // ========================================================================
    // Emitter Management
    // ========================================================================

    /**
     * Spawn an emitter
     */
    spawnEmitter(
        typeName: string,
        gridX: number,
        gridY: number,
        worldX: number,
        worldY: number
    ): number {
        const em = this.emitters;
        if (em.count >= MAX_EMITTERS) return -1;

        const typeId = EMITTER_TYPE_MAP[typeName as keyof typeof EMITTER_TYPE_MAP];
        const arch = EMITTER_ARCHETYPES[typeId];
        if (!arch) return -1;

        const i = em.count++;
        const id = this.nextId++;

        // Identity
        em.id[i] = id;
        em.type[i] = typeId;
        em.flags[i] = arch.flags;

        // Grid position
        em.gridX[i] = gridX;
        em.gridY[i] = gridY;

        // World position
        em.x[i] = worldX;
        em.y[i] = worldY;

        // State
        em.level[i] = 0;
        em.cooldown[i] = 0;
        em.angle[i] = 0;
        em.targetIndex[i] = -1;
        em.fireAccumulator[i] = 0;

        return i;
    }

    /**
     * Remove emitter at index using swap-remove
     */
    removeEmitterAt(index: number): void {
        const em = this.emitters;
        if (index >= em.count || index < 0) return;

        const lastIdx = em.count - 1;
        if (index !== lastIdx) {
            em.id[index] = em.id[lastIdx];
            em.type[index] = em.type[lastIdx];
            em.flags[index] = em.flags[lastIdx];
            em.gridX[index] = em.gridX[lastIdx];
            em.gridY[index] = em.gridY[lastIdx];
            em.x[index] = em.x[lastIdx];
            em.y[index] = em.y[lastIdx];
            em.level[index] = em.level[lastIdx];
            em.cooldown[index] = em.cooldown[lastIdx];
            em.angle[index] = em.angle[lastIdx];
            em.targetIndex[index] = em.targetIndex[lastIdx];
            em.fireAccumulator[index] = em.fireAccumulator[lastIdx];
        }
        em.count--;
    }

    /**
     * Find emitter at grid position
     */
    findEmitterAtGrid(gridX: number, gridY: number): number {
        const em = this.emitters;
        for (let i = 0; i < em.count; i++) {
            if (em.gridX[i] === gridX && em.gridY[i] === gridY) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Upgrade emitter
     */
    upgradeEmitter(index: number): void {
        if (index < 0 || index >= this.emitters.count) return;
        this.emitters.level[index]++;
    }

    // ========================================================================
    // Death Particle Management
    // ========================================================================

    /**
     * Spawn death explosion particles
     */
    spawnDeathExplosion(x: number, y: number, color: number, size: number): void {
        const dp = this.deathParticles;
        const count = Math.min(Math.floor(8 + size * 0.5), MAX_DEATH_PARTICLES - dp.count);

        for (let n = 0; n < count; n++) {
            if (dp.count >= MAX_DEATH_PARTICLES) break;

            const i = dp.count++;
            const angle = (Math.PI * 2 / count) * n + Math.random() * 0.5;
            const speed = 80 + Math.random() * 120;

            dp.x[i] = x + (Math.random() - 0.5) * size;
            dp.y[i] = y + (Math.random() - 0.5) * size;
            dp.vx[i] = Math.cos(angle) * speed;
            dp.vy[i] = Math.sin(angle) * speed - 50;
            dp.color[i] = Math.random() > 0.3 ? color : this.lightenColor(color, 0.5);
            dp.size[i] = 3 + Math.random() * 4;
            dp.life[i] = 0.5 + Math.random() * 0.5;
            dp.maxLife[i] = dp.life[i];
        }
    }

    /**
     * Remove death particle at index using swap-remove
     */
    removeDeathParticleAt(index: number): void {
        const dp = this.deathParticles;
        if (index >= dp.count || index < 0) return;

        const lastIdx = dp.count - 1;
        if (index !== lastIdx) {
            dp.x[index] = dp.x[lastIdx];
            dp.y[index] = dp.y[lastIdx];
            dp.vx[index] = dp.vx[lastIdx];
            dp.vy[index] = dp.vy[lastIdx];
            dp.color[index] = dp.color[lastIdx];
            dp.size[index] = dp.size[lastIdx];
            dp.life[index] = dp.life[lastIdx];
            dp.maxLife[index] = dp.maxLife[lastIdx];
        }
        dp.count--;
    }

    // ========================================================================
    // Spatial Hashing
    // ========================================================================

    /**
     * Update spatial hash for enemies
     * Call this once per frame after enemy positions are updated
     */
    updateEnemySpatialHash(): void {
        this.enemySpatialCells.clear();
        const e = this.enemies;

        for (let i = 0; i < e.count; i++) {
            const cellX = Math.floor(e.x[i] / this.spatialCellSize);
            const cellY = Math.floor(e.y[i] / this.spatialCellSize);
            const key = cellX + cellY * 10007;

            let cell = this.enemySpatialCells.get(key);
            if (!cell) {
                cell = [];
                this.enemySpatialCells.set(key, cell);
            }
            cell.push(i);
        }
    }

    /**
     * Get enemy indices near a position
     */
    getEnemiesNear(x: number, y: number): number[] {
        const result: number[] = [];
        const cellX = Math.floor(x / this.spatialCellSize);
        const cellY = Math.floor(y / this.spatialCellSize);

        // Check 3x3 grid of cells
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = (cellX + dx) + (cellY + dy) * 10007;
                const cell = this.enemySpatialCells.get(key);
                if (cell) {
                    for (const idx of cell) {
                        result.push(idx);
                    }
                }
            }
        }

        return result;
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private lightenColor(color: number, factor: number): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }

    /**
     * Get archetype for enemy type
     */
    getEnemyArchetype(typeId: number) {
        return ENEMY_ARCHETYPES[typeId];
    }

    /**
     * Get archetype for projectile type
     */
    getProjectileArchetype(typeId: number) {
        return PROJECTILE_ARCHETYPES[typeId];
    }

    /**
     * Get archetype for emitter type
     */
    getEmitterArchetype(typeId: number) {
        return EMITTER_ARCHETYPES[typeId];
    }

    /**
     * Clear all entities
     */
    clear(): void {
        this.enemies.count = 0;
        this.projectiles.count = 0;
        this.projectiles.hitEnemies.clear();
        this.emitters.count = 0;
        this.deathParticles.count = 0;
        this.enemySpatialCells.clear();
    }
}
