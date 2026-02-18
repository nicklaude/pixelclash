/**
 * Targeting System
 *
 * Handles emitter target acquisition and firing logic.
 */

import { EnemyArrays, EmitterArrays } from '../types';
import { EMITTER_ARCHETYPES, EMITTER_TYPE_REVERSE } from '../archetypes';
import { EMITTER_DEFS, CELL_SIZE, getUpgradeMultiplier } from '../../config';

/**
 * Update emitter targets - find nearest enemy in range.
 */
export function updateTargeting(
    emitters: EmitterArrays,
    enemies: EnemyArrays,
    getEnemiesNear: (x: number, y: number) => number[]
): void {
    for (let ti = 0; ti < emitters.count; ti++) {
        const typeId = emitters.type[ti];
        const typeName = EMITTER_TYPE_REVERSE[typeId];
        const def = EMITTER_DEFS[typeName];

        // Calculate range with level bonus
        const rangeMult = getUpgradeMultiplier(emitters.level[ti]).range;
        const range = def.range * CELL_SIZE * rangeMult;
        const rangeSq = range * range;

        let bestTarget = -1;
        let bestDistSq = rangeSq;

        const tx = emitters.x[ti];
        const ty = emitters.y[ti];

        // Use spatial hash for nearby enemies
        const nearbyEnemies = getEnemiesNear(tx, ty);

        for (const ei of nearbyEnemies) {
            const dx = enemies.x[ei] - tx;
            const dy = enemies.y[ei] - ty;
            const distSq = dx * dx + dy * dy;

            if (distSq <= bestDistSq) {
                bestDistSq = distSq;
                bestTarget = ei;
            }
        }

        emitters.targetIndex[ti] = bestTarget;

        // Update aim angle if we have a target
        if (bestTarget >= 0) {
            const dx = enemies.x[bestTarget] - tx;
            const dy = enemies.y[bestTarget] - ty;
            emitters.angle[ti] = Math.atan2(dy, dx);
        }
    }
}

/**
 * Result of firing system - projectiles to spawn
 */
export interface FireResult {
    emitterIndex: number;
    typeId: number;
    x: number;
    y: number;
    angle: number;
    level: number;
}

/**
 * Update emitter firing.
 * Returns array of fire events for projectile spawning.
 */
export function updateFiring(
    emitters: EmitterArrays,
    enemies: EnemyArrays,
    dt: number,
    fireResults: FireResult[]
): void {
    fireResults.length = 0;

    for (let ti = 0; ti < emitters.count; ti++) {
        // Skip if no target
        if (emitters.targetIndex[ti] < 0) {
            // Reset fire accumulator when no target to prevent burst firing
            emitters.fireAccumulator[ti] = 0;
            continue;
        }

        const targetIdx = emitters.targetIndex[ti];
        if (targetIdx >= enemies.count) {
            // Target no longer valid
            emitters.targetIndex[ti] = -1;
            emitters.fireAccumulator[ti] = 0;
            continue;
        }

        const typeId = emitters.type[ti];
        const typeName = EMITTER_TYPE_REVERSE[typeId];
        const def = EMITTER_DEFS[typeName];

        // Calculate fire rate with level bonus
        const fireRateMult = getUpgradeMultiplier(emitters.level[ti]).fireRate;
        const fireRate = def.fireRate * fireRateMult;
        const fireInterval = 1 / fireRate;

        // Lead targeting - predict where enemy will be
        const tx = emitters.x[ti];
        const ty = emitters.y[ti];
        const ex = enemies.x[targetIdx];
        const ey = enemies.y[targetIdx];

        const dx = ex - tx;
        const dy = ey - ty;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const timeToHit = dist / def.particleSpeed;

        // Predict position based on enemy path direction
        let predictX = ex;
        let predictY = ey;

        // Simple prediction using enemy velocity
        const evx = enemies.baseSpeed[targetIdx] * (enemies.slowTimer[targetIdx] > 0 ? enemies.slowFactor[targetIdx] : 1);
        // We'd need path direction here - for now just use current position

        // Update aim angle with prediction
        const aimDx = predictX - tx;
        const aimDy = predictY - ty;
        emitters.angle[ti] = Math.atan2(aimDy, aimDx);

        // Accumulate fire time
        emitters.fireAccumulator[ti] += dt;

        // Fire as many shots as accumulated
        while (emitters.fireAccumulator[ti] >= fireInterval) {
            emitters.fireAccumulator[ti] -= fireInterval;

            // Generate fire events for each particle
            for (let p = 0; p < def.particlesPerShot; p++) {
                fireResults.push({
                    emitterIndex: ti,
                    typeId,
                    x: tx,
                    y: ty,
                    angle: emitters.angle[ti],
                    level: emitters.level[ti],
                });
            }
        }
    }
}
