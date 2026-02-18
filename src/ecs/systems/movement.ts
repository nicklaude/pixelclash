/**
 * Movement Systems
 *
 * Pure functions that operate on typed arrays for cache-friendly updates.
 * No object allocations in hot paths.
 */

import { Vec2 } from '../../types';
import { EnemyArrays, ProjectileArrays, DeathParticleArrays, EF_ON_FIRE, EF_SLOWED, EF_DIRTY } from '../types';
import { KNOCKBACK_VELOCITY_THRESHOLD } from '../../config';

/**
 * Update enemy positions based on velocity and path following.
 * Returns array of indices of enemies that reached the end of the path.
 */
export function updateEnemyMovement(
    enemies: EnemyArrays,
    worldPath: Vec2[],
    dt: number,
    reachedEndIndices: number[]
): void {
    reachedEndIndices.length = 0;

    for (let i = 0; i < enemies.count; i++) {
        // Apply friction to knockback velocity
        const frictionFactor = Math.pow(enemies.friction[i], dt * 60);
        enemies.vx[i] *= frictionFactor;
        enemies.vy[i] *= frictionFactor;

        // Clear very small velocities
        if (Math.abs(enemies.vx[i]) < 1) enemies.vx[i] = 0;
        if (Math.abs(enemies.vy[i]) < 1) enemies.vy[i] = 0;

        // Apply knockback velocity
        enemies.x[i] += enemies.vx[i] * dt;
        enemies.y[i] += enemies.vy[i] * dt;

        // Path following (when not being knocked back)
        const knockbackSpeed = Math.sqrt(
            enemies.vx[i] * enemies.vx[i] +
            enemies.vy[i] * enemies.vy[i]
        );

        if (knockbackSpeed < KNOCKBACK_VELOCITY_THRESHOLD) {
            const pathIdx = enemies.pathIndex[i];
            const target = worldPath[pathIdx + 1];

            if (!target) {
                // Reached end of path
                reachedEndIndices.push(i);
                continue;
            }

            // Calculate movement speed with slow effect
            let speedMult = 1;
            if (enemies.slowTimer[i] > 0) {
                speedMult = enemies.slowFactor[i];
                enemies.slowTimer[i] -= dt;
                if (enemies.slowTimer[i] <= 0) {
                    enemies.flags[i] &= ~EF_SLOWED;
                }
            }

            const moveSpeed = enemies.baseSpeed[i] * speedMult;

            // Move towards target
            const dx = target.x - enemies.x[i];
            const dy = target.y - enemies.y[i];
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 2) {
                // Reached waypoint
                enemies.x[i] = target.x;
                enemies.y[i] = target.y;
                enemies.pathIndex[i]++;
            } else {
                // Move towards waypoint
                const nx = dx / dist;
                const ny = dy / dist;
                enemies.x[i] += nx * moveSpeed * dt;
                enemies.y[i] += ny * moveSpeed * dt;
            }
        }

        // Reset slow factor for next frame
        enemies.slowFactor[i] = 1;
    }
}

/**
 * Update projectile positions.
 * Returns array of indices of projectiles that expired or went out of bounds.
 */
export function updateProjectileMovement(
    projectiles: ProjectileArrays,
    dt: number,
    deadIndices: number[],
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
): void {
    deadIndices.length = 0;

    for (let i = 0; i < projectiles.count; i++) {
        // Update position
        projectiles.x[i] += projectiles.vx[i] * dt;
        projectiles.y[i] += projectiles.vy[i] * dt;

        // Update lifespan
        projectiles.lifespan[i] -= dt;

        // Check if dead
        const outOfBounds =
            projectiles.x[i] < bounds.minX ||
            projectiles.x[i] > bounds.maxX ||
            projectiles.y[i] < bounds.minY ||
            projectiles.y[i] > bounds.maxY;

        if (projectiles.lifespan[i] <= 0 || projectiles.pierce[i] <= 0 || outOfBounds) {
            deadIndices.push(i);
        }
    }
}

/**
 * Update death particle positions with gravity.
 * Returns array of indices of particles that expired.
 */
export function updateDeathParticleMovement(
    particles: DeathParticleArrays,
    dt: number,
    deadIndices: number[]
): void {
    deadIndices.length = 0;

    for (let i = 0; i < particles.count; i++) {
        // Physics update
        particles.x[i] += particles.vx[i] * dt;
        particles.y[i] += particles.vy[i] * dt;
        particles.vy[i] += 200 * dt;  // Gravity
        particles.life[i] -= dt;
        particles.size[i] *= 0.98;

        // Check if dead
        if (particles.life[i] <= 0 || particles.size[i] < 0.5) {
            deadIndices.push(i);
        }
    }
}
