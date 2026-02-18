/**
 * Enemy Renderer
 *
 * Bridges ECS enemy data with PixiJS display objects.
 * Maintains a pool of PixiJS Graphics objects that are synced with ECS data.
 *
 * This approach:
 * - Keeps all game logic in pure ECS systems (typed arrays)
 * - Only uses PixiJS for rendering (no game state in display objects)
 * - Reuses Graphics objects to minimize GC pressure
 */

import { Container, Graphics } from 'pixi.js';
import { EnemyArrays, EF_FLASHING, EF_ON_FIRE, EF_DIRTY, EF_HEALTH_DIRTY, ENEMY_TYPE_REVERSE } from './types';
import { ENEMY_ARCHETYPES } from './archetypes';
import { ENEMY_DEFS } from '../config';

interface EnemyGraphics {
    container: Container;
    body: Graphics;
    healthBar: Graphics;
    // Track last rendered state to avoid unnecessary redraws
    lastTypeId: number;
    lastFlashing: boolean;
    lastOnFire: boolean;
    lastHealthPct: number;
}

/**
 * Manages rendering of ECS enemies to PixiJS.
 * Pool-based approach syncs display objects with array indices.
 */
export class EnemyRenderer {
    private layer: Container;
    private pool: EnemyGraphics[] = [];
    private activeCount: number = 0;

    constructor(layer: Container) {
        this.layer = layer;
    }

    /**
     * Sync enemy graphics with ECS data.
     * Call this once per frame after systems have updated.
     */
    sync(enemies: EnemyArrays): void {
        // Ensure we have enough graphics objects
        while (this.pool.length < enemies.count) {
            this.pool.push(this.createEnemyGraphics());
        }

        // Update active graphics
        for (let i = 0; i < enemies.count; i++) {
            const gfx = this.pool[i];

            // Show if not already visible
            if (!gfx.container.visible) {
                gfx.container.visible = true;
                if (!gfx.container.parent) {
                    this.layer.addChild(gfx.container);
                }
            }

            // Update position
            gfx.container.position.set(enemies.x[i], enemies.y[i]);

            // Check if we need to redraw
            const typeId = enemies.type[i];
            const isFlashing = (enemies.flags[i] & EF_FLASHING) !== 0;
            const isOnFire = (enemies.flags[i] & EF_ON_FIRE) !== 0;
            const healthPct = enemies.health[i] / enemies.maxHealth[i];

            const needsBodyRedraw =
                (enemies.flags[i] & EF_DIRTY) !== 0 ||
                gfx.lastTypeId !== typeId ||
                gfx.lastFlashing !== isFlashing ||
                gfx.lastOnFire !== isOnFire;

            const needsHealthRedraw =
                (enemies.flags[i] & EF_HEALTH_DIRTY) !== 0 ||
                Math.abs(gfx.lastHealthPct - healthPct) > 0.01;

            if (needsBodyRedraw) {
                this.drawEnemyBody(gfx.body, typeId, isFlashing, isOnFire, enemies.size[i]);
                gfx.lastTypeId = typeId;
                gfx.lastFlashing = isFlashing;
                gfx.lastOnFire = isOnFire;
                enemies.flags[i] &= ~EF_DIRTY;
            }

            if (needsHealthRedraw) {
                this.drawHealthBar(gfx.healthBar, healthPct, enemies.size[i]);
                gfx.lastHealthPct = healthPct;
                enemies.flags[i] &= ~EF_HEALTH_DIRTY;
            }
        }

        // Hide excess graphics
        for (let i = enemies.count; i < this.activeCount; i++) {
            this.pool[i].container.visible = false;
        }

        this.activeCount = enemies.count;
    }

    /**
     * Create a new enemy graphics object
     */
    private createEnemyGraphics(): EnemyGraphics {
        const container = new Container();
        const body = new Graphics();
        const healthBar = new Graphics();

        container.addChild(body, healthBar);
        container.visible = false;

        return {
            container,
            body,
            healthBar,
            lastTypeId: -1,
            lastFlashing: false,
            lastOnFire: false,
            lastHealthPct: 1,
        };
    }

    /**
     * Draw enemy body graphics
     */
    private drawEnemyBody(
        g: Graphics,
        typeId: number,
        isFlashing: boolean,
        isOnFire: boolean,
        size: number
    ): void {
        g.clear();

        const arch = ENEMY_ARCHETYPES[typeId];
        const typeName = ENEMY_TYPE_REVERSE[typeId];
        const def = ENEMY_DEFS[typeName];
        const s = size || def.size;

        let color = arch.color;
        if (isFlashing) {
            color = 0xffffff;
        }

        const dark = this.darkenColor(color, 0.5);

        // DOT fire effect
        if (isOnFire) {
            for (let i = 0; i < 4; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = s * 0.6 + Math.random() * 4;
                const fx = Math.cos(angle) * dist;
                const fy = Math.sin(angle) * dist;
                g.rect(fx - 2, fy - 3, 4, 6).fill({ color: 0xff6600, alpha: 0.9 });
                g.rect(fx - 1, fy - 5, 2, 4).fill({ color: 0xffaa00, alpha: 0.8 });
            }
        }

        // Draw pixelated enemy based on type
        switch (typeName) {
            case 'grunt':
                // Angry square with spikes
                g.rect(-s, -s, s * 2, s * 2).fill(color);
                g.rect(-s - 3, -s - 3, 4, 4).fill(dark);
                g.rect(s - 1, -s - 3, 4, 4).fill(dark);
                g.rect(-s - 3, s - 1, 4, 4).fill(dark);
                g.rect(s - 1, s - 1, 4, 4).fill(dark);
                g.rect(-s * 0.5, -s * 0.3, 3, 4).fill(0x000000);
                g.rect(s * 0.2, -s * 0.3, 3, 4).fill(0x000000);
                g.rect(-s * 0.4, s * 0.3, s * 0.8, 2).fill(0x000000);
                break;

            case 'fast':
                // Diamond/arrow shape
                g.poly([0, -s, s, 0, 0, s * 0.7, -s, 0]).fill(color);
                g.rect(-s - 6, -1, 4, 2).fill({ color: dark, alpha: 0.6 });
                g.rect(-s - 10, 3, 3, 2).fill({ color: dark, alpha: 0.6 });
                g.rect(-2, -s * 0.3, 4, 3).fill(0x000000);
                break;

            case 'tank':
                // Big chunky square with armor plates
                g.rect(-s - 2, -s - 2, s * 2 + 4, s * 2 + 4).fill(dark);
                g.rect(-s, -s, s * 2, s * 2).fill(color);
                g.rect(-s + 2, -s + 2, s - 2, s - 2).fill(this.lightenColor(color, 0.3));
                g.rect(-s * 0.6, -s * 0.2, s * 1.2, 4).fill(0x222222);
                g.rect(-s * 0.5, -s * 0.1, s, 2).fill({ color: 0x44ffff, alpha: 0.8 });
                break;

            case 'shielded':
                // Hexagon-ish shape
                g.poly([
                    -s * 0.5, -s,
                    s * 0.5, -s,
                    s, 0,
                    s * 0.5, s,
                    -s * 0.5, s,
                    -s, 0
                ]).fill(color);
                g.rect(-s * 0.3, -s * 0.8, 3, s * 0.6).fill({ color: 0xffffff, alpha: 0.3 });
                g.rect(-4, -2, 3, 3).fill(0x000000);
                g.rect(1, -2, 3, 3).fill(0x000000);
                break;

            case 'splitter':
                // Two connected blobs
                g.rect(-s, -s * 0.7, s * 0.9, s * 1.4).fill(color);
                g.rect(s * 0.1, -s * 0.7, s * 0.9, s * 1.4).fill(color);
                g.rect(-2, -s * 0.3, 4, s * 0.6).fill(dark);
                g.rect(-s * 0.7, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(-s * 0.4, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.3, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.6, -s * 0.2, 2, 2).fill(0x000000);
                break;

            case 'boss':
                // Big scary boss - skull-like
                g.rect(-s - 3, -s - 3, s * 2 + 6, s * 2 + 6).fill(dark);
                g.rect(-s, -s, s * 2, s * 2).fill(color);
                g.rect(-s * 0.6, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);
                g.rect(s * 0.1, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);
                g.rect(-s * 0.5, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);
                g.rect(s * 0.2, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);
                for (let i = 0; i < 4; i++) {
                    g.rect(-s * 0.6 + i * s * 0.35, s * 0.3, s * 0.25, s * 0.4).fill(0xffffff);
                }
                break;

            default:
                // Fallback
                g.rect(-s, -s, s * 2, s * 2).fill(color);
        }
    }

    /**
     * Draw health bar
     */
    private drawHealthBar(g: Graphics, healthPct: number, size: number): void {
        g.clear();

        // Only show if damaged
        if (healthPct >= 1) return;

        const barWidth = Math.max(16, size * 1.2);
        const barHeight = 3;
        const barY = -size - 6;

        // Background
        g.rect(-barWidth / 2, barY, barWidth, barHeight)
            .fill({ color: 0x222222, alpha: 0.8 });

        // Health
        let healthColor = 0x44ff44;
        if (healthPct < 0.5) healthColor = 0xffcc00;
        if (healthPct < 0.25) healthColor = 0xff4444;
        g.rect(-barWidth / 2, barY, barWidth * healthPct, barHeight)
            .fill(healthColor);

        // Border
        g.rect(-barWidth / 2, barY, barWidth, barHeight)
            .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
    }

    /**
     * Get enemy container at index (for spatial hash compatibility)
     */
    getContainerAt(index: number): Container | null {
        if (index < 0 || index >= this.pool.length) return null;
        return this.pool[index].container;
    }

    /**
     * Clear all graphics
     */
    clear(): void {
        for (const gfx of this.pool) {
            gfx.container.visible = false;
        }
        this.activeCount = 0;
    }

    /**
     * Destroy all resources
     */
    destroy(): void {
        for (const gfx of this.pool) {
            gfx.container.destroy();
        }
        this.pool.length = 0;
        this.activeCount = 0;
    }

    private darkenColor(color: number, factor: number): number {
        const r = Math.floor(((color >> 16) & 255) * factor);
        const g = Math.floor(((color >> 8) & 255) * factor);
        const b = Math.floor((color & 255) * factor);
        return (r << 16) | (g << 8) | b;
    }

    private lightenColor(color: number, factor: number): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }
}
