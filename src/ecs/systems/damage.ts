/**
 * Damage Systems
 *
 * Handle damage over time, flash effects, and death processing.
 */

import { EnemyArrays, EF_ON_FIRE, EF_FLASHING, EF_DIRTY, EF_HEALTH_DIRTY } from '../types';

/**
 * Process damage over time effects on enemies.
 * Returns array of indices of enemies killed by DOT.
 */
export function processDOT(
    enemies: EnemyArrays,
    dt: number,
    killedIndices: number[]
): void {
    killedIndices.length = 0;

    for (let i = 0; i < enemies.count; i++) {
        // Skip if no DOT active
        if (enemies.dotTimer[i] <= 0) continue;

        // Apply DOT damage
        enemies.dotTimer[i] -= dt;
        enemies.health[i] -= enemies.dotDamage[i] * dt;
        enemies.flags[i] |= EF_HEALTH_DIRTY;

        // Update DOT flag
        if (enemies.dotTimer[i] <= 0) {
            enemies.flags[i] &= ~EF_ON_FIRE;
            enemies.flags[i] |= EF_DIRTY;  // Need visual update when fire stops
        }

        // Check if killed
        if (enemies.health[i] <= 0) {
            killedIndices.push(i);
        }
    }
}

/**
 * Process flash timers (visual hit feedback).
 */
export function processFlashTimers(
    enemies: EnemyArrays,
    dt: number
): void {
    for (let i = 0; i < enemies.count; i++) {
        if (enemies.flashTimer[i] > 0) {
            enemies.flashTimer[i] -= dt;
            if (enemies.flashTimer[i] <= 0) {
                enemies.flags[i] &= ~EF_FLASHING;
                enemies.flags[i] |= EF_DIRTY;  // Need visual update when flash ends
            }
        }
    }
}

/**
 * Result of death processing for a single enemy
 */
export interface EnemyDeathResult {
    index: number;
    reward: number;
    x: number;
    y: number;
    color: number;
    size: number;
    typeId: number;
    reachedEnd: boolean;
}

/**
 * Collect death information for enemies that died this frame.
 * Does not remove enemies - that should be done after processing all deaths.
 */
export function collectDeaths(
    enemies: EnemyArrays,
    killedIndices: number[],
    reachedEndIndices: number[],
    results: EnemyDeathResult[]
): void {
    results.length = 0;

    // Process killed enemies
    for (const idx of killedIndices) {
        results.push({
            index: idx,
            reward: enemies.reward[idx],
            x: enemies.x[idx],
            y: enemies.y[idx],
            color: enemies.color[idx],
            size: enemies.size[idx],
            typeId: enemies.type[idx],
            reachedEnd: false,
        });
    }

    // Process enemies that reached end
    for (const idx of reachedEndIndices) {
        // Avoid duplicates if enemy was also killed
        if (!killedIndices.includes(idx)) {
            results.push({
                index: idx,
                reward: 0,
                x: enemies.x[idx],
                y: enemies.y[idx],
                color: enemies.color[idx],
                size: enemies.size[idx],
                typeId: enemies.type[idx],
                reachedEnd: true,
            });
        }
    }
}
