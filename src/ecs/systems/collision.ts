/**
 * Collision Detection System
 *
 * Uses spatial hashing for O(1) average collision detection instead of O(n*m).
 */

import { EnemyArrays, ProjectileArrays, CollisionEvent, EF_KNOCKBACKABLE } from '../types';
import { ENEMY_DEFS } from '../../config';
import { ENEMY_TYPE_REVERSE } from '../types';

/**
 * Detect collisions between projectiles and enemies.
 * Uses spatial hashing for efficient detection.
 *
 * @param projectiles - Projectile array data
 * @param enemies - Enemy array data
 * @param getEnemiesNear - Spatial hash lookup function
 * @param hasHit - Function to check if projectile already hit an enemy
 * @param collisions - Output array of collision events (reused to avoid allocation)
 */
export function detectCollisions(
    projectiles: ProjectileArrays,
    enemies: EnemyArrays,
    getEnemiesNear: (x: number, y: number) => number[],
    hasHit: (projIndex: number, enemyId: number) => boolean,
    collisions: CollisionEvent[]
): void {
    collisions.length = 0;

    for (let pi = 0; pi < projectiles.count; pi++) {
        // Skip dead projectiles
        if (projectiles.pierce[pi] <= 0) continue;

        const px = projectiles.x[pi];
        const py = projectiles.y[pi];

        // Get nearby enemies using spatial hash
        const nearbyEnemies = getEnemiesNear(px, py);

        for (const ei of nearbyEnemies) {
            // Skip if already hit this enemy
            if (hasHit(pi, enemies.id[ei])) continue;

            // Calculate distance
            const dx = enemies.x[ei] - px;
            const dy = enemies.y[ei] - py;
            const distSq = dx * dx + dy * dy;

            // Get hit radius based on enemy size (accounting for scale) + projectile size + buffer
            // This ensures scaled enemies (like splitter children) have appropriate hitboxes
            const enemyRadius = enemies.size[ei] * (enemies.scale ? enemies.scale[ei] : 1);
            const projectileRadius = projectiles.size[pi] || 3;
            const hitRadius = enemyRadius + projectileRadius + 2; // 2px buffer for tolerance
            const hitRadiusSq = hitRadius * hitRadius;

            if (distSq < hitRadiusSq) {
                collisions.push({
                    projectileIndex: pi,
                    enemyIndex: ei,
                });
            }
        }
    }
}

/**
 * Process collision events - apply damage, knockback, and effects.
 *
 * @param collisions - Array of collision events to process
 * @param projectiles - Projectile array data
 * @param enemies - Enemy array data
 * @param registerHit - Function to register a hit
 * @param applyDOT - Function to apply DOT effect
 * @param applySlow - Function to apply slow effect
 * @param damageEnemy - Function to apply damage
 * @param knockbackEnemy - Function to apply knockback
 * @param archetypes - Projectile archetypes for effect data
 * @returns Array of enemy indices that were killed
 */
export function processCollisions(
    collisions: CollisionEvent[],
    projectiles: ProjectileArrays,
    enemies: EnemyArrays,
    registerHit: (projIndex: number, enemyId: number) => void,
    applyDOT: (enemyIndex: number, damage: number, duration: number) => void,
    applySlow: (enemyIndex: number, factor: number, duration: number) => void,
    damageEnemy: (enemyIndex: number, damage: number) => boolean,
    knockbackEnemy: (enemyIndex: number, forceX: number, forceY: number) => void,
    projectileArchetypes: any[]
): number[] {
    const killedIndices: number[] = [];

    for (const collision of collisions) {
        const pi = collision.projectileIndex;
        const ei = collision.enemyIndex;

        // Register the hit
        registerHit(pi, enemies.id[ei]);

        // Apply damage
        const killed = damageEnemy(ei, projectiles.damage[pi]);

        if (killed) {
            killedIndices.push(ei);
        } else {
            // Apply knockback
            const velMagSq = projectiles.vx[pi] ** 2 + projectiles.vy[pi] ** 2;
            if (velMagSq > 0) {
                const velMag = Math.sqrt(velMagSq);
                const nx = projectiles.vx[pi] / velMag;
                const ny = projectiles.vy[pi] / velMag;
                knockbackEnemy(ei, nx * projectiles.knockbackForce[pi], ny * projectiles.knockbackForce[pi]);
            }

            // Apply special effects based on projectile type
            const arch = projectileArchetypes[projectiles.type[pi]];
            if (arch) {
                // DOT effect (fire)
                if (arch.dotDamage && arch.dotDuration) {
                    applyDOT(ei, arch.dotDamage, arch.dotDuration);
                }

                // Slow effect (goo)
                if (arch.slowFactor && arch.slowDuration) {
                    applySlow(ei, arch.slowFactor, arch.slowDuration);
                }
            }
        }
    }

    return killedIndices;
}

/**
 * Apply puddle slow effects to enemies.
 * This is separate from projectile collision to handle ground hazards.
 */
export function applyPuddleEffects(
    enemies: EnemyArrays,
    puddleContains: (x: number, y: number) => { slowFactor: number } | null
): void {
    for (let i = 0; i < enemies.count; i++) {
        const puddle = puddleContains(enemies.x[i], enemies.y[i]);
        if (puddle) {
            enemies.slowFactor[i] = Math.min(enemies.slowFactor[i], puddle.slowFactor);
        }
    }
}
