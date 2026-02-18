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
 *
 * Phase 5 Update:
 * - Added procedural enemy visuals with color/size/pattern variations
 * - Each enemy type has 5 pattern variants (30 total patterns)
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
    lastPatternId: number;
    lastColorVariation: number;
}

/**
 * Manages rendering of ECS enemies to PixiJS.
 * Pool-based approach syncs display objects with array indices.
 */
export class EnemyRenderer {
    private layer: Container;
    private pool: EnemyGraphics[] = [];
    private activeCount: number = 0;
    private time: number = 0;

    constructor(layer: Container) {
        this.layer = layer;
    }

    /**
     * Sync enemy graphics with ECS data.
     * Call this once per frame after systems have updated.
     */
    sync(enemies: EnemyArrays, dt: number = 0.016): void {
        this.time += dt;

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

            // Update position with subtle bob animation
            const animPhase = enemies.animPhase[i];
            const bobOffset = Math.sin(this.time * 3 + animPhase) * 1.5;
            gfx.container.position.set(enemies.x[i], enemies.y[i] + bobOffset);

            // Check if we need to redraw
            const typeId = enemies.type[i];
            const isFlashing = (enemies.flags[i] & EF_FLASHING) !== 0;
            const isOnFire = (enemies.flags[i] & EF_ON_FIRE) !== 0;
            const healthPct = enemies.health[i] / enemies.maxHealth[i];
            const patternId = enemies.patternId[i];
            const colorVariation = enemies.colorVariation[i];

            const needsBodyRedraw =
                (enemies.flags[i] & EF_DIRTY) !== 0 ||
                gfx.lastTypeId !== typeId ||
                gfx.lastFlashing !== isFlashing ||
                gfx.lastOnFire !== isOnFire ||
                gfx.lastPatternId !== patternId ||
                gfx.lastColorVariation !== colorVariation;

            const needsHealthRedraw =
                (enemies.flags[i] & EF_HEALTH_DIRTY) !== 0 ||
                Math.abs(gfx.lastHealthPct - healthPct) > 0.01;

            if (needsBodyRedraw) {
                this.drawEnemyBody(gfx.body, i, enemies);
                gfx.lastTypeId = typeId;
                gfx.lastFlashing = isFlashing;
                gfx.lastOnFire = isOnFire;
                gfx.lastPatternId = patternId;
                gfx.lastColorVariation = colorVariation;
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
            lastPatternId: -1,
            lastColorVariation: 0,
        };
    }

    /**
     * Draw enemy body graphics with procedural variations
     */
    private drawEnemyBody(
        g: Graphics,
        index: number,
        enemies: EnemyArrays
    ): void {
        g.clear();

        const typeId = enemies.type[index];
        const typeName = ENEMY_TYPE_REVERSE[typeId];
        const def = ENEMY_DEFS[typeName];
        const arch = ENEMY_ARCHETYPES[typeId];
        const baseSize = enemies.size[index] || def.size;
        const scale = enemies.scale[index];
        const isFlashing = (enemies.flags[index] & EF_FLASHING) !== 0;
        const isOnFire = (enemies.flags[index] & EF_ON_FIRE) !== 0;

        // Get variation data
        const colorVariation = enemies.colorVariation[index];
        const sizeVariation = enemies.sizeVariation[index];
        const patternId = enemies.patternId[index];

        // Apply size variation
        const s = baseSize * scale * (1 + sizeVariation / 100);

        // Apply color variation
        let color = arch.color;
        if (isFlashing) {
            color = 0xffffff;
        } else {
            color = this.shiftColor(arch.color, colorVariation);
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

        // Draw enemy based on type and pattern
        this.drawEnemyShape(g, typeName, color, dark, s, patternId);
    }

    /**
     * Draw enemy shape with pattern variation
     */
    private drawEnemyShape(
        g: Graphics,
        typeName: string,
        color: number,
        dark: number,
        s: number,
        patternId: number
    ): void {
        switch (typeName) {
            case 'grunt':
                this.drawGrunt(g, color, dark, s, patternId);
                break;
            case 'fast':
                this.drawFast(g, color, dark, s, patternId);
                break;
            case 'tank':
                this.drawTank(g, color, dark, s, patternId);
                break;
            case 'shielded':
                this.drawShielded(g, color, dark, s, patternId);
                break;
            case 'splitter':
                this.drawSplitter(g, color, dark, s, patternId);
                break;
            case 'boss':
                this.drawBoss(g, color, dark, s, patternId);
                break;
            default:
                // Fallback
                g.rect(-s, -s, s * 2, s * 2).fill(color);
        }
    }

    // ========== Grunt Patterns ==========
    private drawGrunt(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Angry square with spikes
        g.rect(-s, -s, s * 2, s * 2).fill(color);
        g.rect(-s - 3, -s - 3, 4, 4).fill(dark);
        g.rect(s - 1, -s - 3, 4, 4).fill(dark);
        g.rect(-s - 3, s - 1, 4, 4).fill(dark);
        g.rect(s - 1, s - 1, 4, 4).fill(dark);

        // Pattern variations
        switch (patternId) {
            case 0: // Plain with eyes
                g.rect(-s * 0.5, -s * 0.3, 3, 4).fill(0x000000);
                g.rect(s * 0.2, -s * 0.3, 3, 4).fill(0x000000);
                g.rect(-s * 0.4, s * 0.3, s * 0.8, 2).fill(0x000000);
                break;
            case 1: // Horizontal stripe
                g.rect(-s * 0.9, 0, s * 1.8, 3).fill(dark);
                g.rect(-s * 0.4, -s * 0.3, 2, 3).fill(0x000000);
                g.rect(s * 0.2, -s * 0.3, 2, 3).fill(0x000000);
                break;
            case 2: // Vertical stripe
                g.rect(-1.5, -s * 0.9, 3, s * 1.8).fill(dark);
                g.rect(-s * 0.5, -s * 0.2, 2, 3).fill(0x000000);
                g.rect(s * 0.3, -s * 0.2, 2, 3).fill(0x000000);
                break;
            case 3: // Corner dots
                g.circle(-s * 0.5, -s * 0.5, 3).fill(dark);
                g.circle(s * 0.5, -s * 0.5, 3).fill(dark);
                g.circle(-s * 0.5, s * 0.5, 3).fill(dark);
                g.circle(s * 0.5, s * 0.5, 3).fill(dark);
                g.rect(-s * 0.4, -s * 0.2, 2, 3).fill(0x000000);
                g.rect(s * 0.2, -s * 0.2, 2, 3).fill(0x000000);
                break;
            case 4: // X marking
                g.moveTo(-s * 0.7, -s * 0.7);
                g.lineTo(s * 0.7, s * 0.7);
                g.stroke({ color: dark, width: 3 });
                g.moveTo(s * 0.7, -s * 0.7);
                g.lineTo(-s * 0.7, s * 0.7);
                g.stroke({ color: dark, width: 3 });
                g.rect(-s * 0.3, -s * 0.4, 2, 3).fill(0x000000);
                g.rect(s * 0.1, -s * 0.4, 2, 3).fill(0x000000);
                break;
        }
    }

    // ========== Fast Enemy Patterns ==========
    private drawFast(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Diamond/arrow
        g.poly([0, -s, s, 0, 0, s * 0.7, -s, 0]).fill(color);

        // Pattern variations
        switch (patternId) {
            case 0: // Plain diamond
                g.rect(-s - 6, -1, 4, 2).fill({ color: dark, alpha: 0.6 });
                g.rect(-s - 10, 3, 3, 2).fill({ color: dark, alpha: 0.6 });
                g.rect(-2, -s * 0.3, 4, 3).fill(0x000000);
                break;
            case 1: // Speed lines
                for (let i = 0; i < 3; i++) {
                    g.rect(-s - 5 - i * 4, -s * 0.3 + i * 3, 3, 2).fill({ color: dark, alpha: 0.7 - i * 0.2 });
                }
                g.rect(-1, -s * 0.2, 3, 2).fill(0x000000);
                break;
            case 2: // Chevron marking
                g.moveTo(-s * 0.5, -s * 0.3);
                g.lineTo(0, s * 0.1);
                g.lineTo(s * 0.5, -s * 0.3);
                g.stroke({ color: dark, width: 2 });
                g.rect(-1, -s * 0.4, 2, 2).fill(0x000000);
                break;
            case 3: // Gradient fade (multiple rects)
                g.poly([0, -s * 0.6, s * 0.6, 0, 0, s * 0.3, -s * 0.6, 0]).fill({ color: dark, alpha: 0.5 });
                g.rect(-1, -s * 0.3, 3, 2).fill(0x000000);
                break;
            case 4: // Double outline
                g.poly([0, -s * 0.7, s * 0.7, 0, 0, s * 0.4, -s * 0.7, 0]).stroke({ color: dark, width: 2 });
                g.rect(-2, -s * 0.3, 4, 3).fill(0x000000);
                break;
        }
    }

    // ========== Tank Patterns ==========
    private drawTank(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Big chunky square
        g.rect(-s - 2, -s - 2, s * 2 + 4, s * 2 + 4).fill(dark);
        g.rect(-s, -s, s * 2, s * 2).fill(color);

        // Pattern variations
        switch (patternId) {
            case 0: // Plain with highlight and visor
                g.rect(-s + 2, -s + 2, s - 2, s - 2).fill(this.lightenColor(color, 0.3));
                g.rect(-s * 0.6, -s * 0.2, s * 1.2, 4).fill(0x222222);
                g.rect(-s * 0.5, -s * 0.1, s, 2).fill({ color: 0x44ffff, alpha: 0.8 });
                break;
            case 1: // Armor plates (grid)
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        g.rect(i * s * 0.6 - 3, j * s * 0.6 - 3, 6, 6).stroke({ color: dark, width: 1 });
                    }
                }
                g.rect(-s * 0.4, -s * 0.15, s * 0.8, 3).fill(0x222222);
                break;
            case 2: // Rivets
                const rivetPositions = [
                    [-s * 0.7, -s * 0.7], [s * 0.7, -s * 0.7],
                    [-s * 0.7, s * 0.7], [s * 0.7, s * 0.7],
                    [0, -s * 0.7], [0, s * 0.7],
                ];
                for (const [rx, ry] of rivetPositions) {
                    g.circle(rx, ry, 2).fill(dark);
                }
                g.rect(-s * 0.5, -s * 0.1, s, 3).fill({ color: 0x44ffff, alpha: 0.6 });
                break;
            case 3: // Battle damage (scratches)
                g.moveTo(-s * 0.6, -s * 0.4);
                g.lineTo(s * 0.3, s * 0.5);
                g.stroke({ color: dark, width: 2 });
                g.moveTo(s * 0.5, -s * 0.6);
                g.lineTo(-s * 0.2, s * 0.3);
                g.stroke({ color: dark, width: 2 });
                g.rect(-s * 0.4, -s * 0.1, s * 0.8, 3).fill({ color: 0x44ffff, alpha: 0.7 });
                break;
            case 4: // Shield emblem
                g.circle(0, 0, s * 0.4).fill(dark);
                g.circle(0, 0, s * 0.25).fill(color);
                g.rect(-s * 0.5, -s * 0.1, s, 2).fill({ color: 0x44ffff, alpha: 0.6 });
                break;
        }
    }

    // ========== Shielded Enemy Patterns ==========
    private drawShielded(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Hexagon
        g.poly([
            -s * 0.5, -s,
            s * 0.5, -s,
            s, 0,
            s * 0.5, s,
            -s * 0.5, s,
            -s, 0
        ]).fill(color);

        // Pattern variations
        switch (patternId) {
            case 0: // Plain with shine
                g.rect(-s * 0.3, -s * 0.8, 3, s * 0.6).fill({ color: 0xffffff, alpha: 0.3 });
                g.rect(-4, -2, 3, 3).fill(0x000000);
                g.rect(1, -2, 3, 3).fill(0x000000);
                break;
            case 1: // Inner hexagon
                g.poly([
                    -s * 0.3, -s * 0.6,
                    s * 0.3, -s * 0.6,
                    s * 0.6, 0,
                    s * 0.3, s * 0.6,
                    -s * 0.3, s * 0.6,
                    -s * 0.6, 0
                ]).stroke({ color: dark, width: 2 });
                g.rect(-3, -2, 2, 2).fill(0x000000);
                g.rect(1, -2, 2, 2).fill(0x000000);
                break;
            case 2: // Energy core
                g.circle(0, 0, s * 0.35).fill(dark);
                g.circle(0, 0, s * 0.2).fill({ color: 0x88ffaa, alpha: 0.7 });
                g.rect(-3, -s * 0.5, 2, 2).fill(0x000000);
                g.rect(1, -s * 0.5, 2, 2).fill(0x000000);
                break;
            case 3: // Force field lines
                g.moveTo(0, -s * 0.8);
                g.lineTo(0, s * 0.8);
                g.stroke({ color: 0xffffff, alpha: 0.2, width: 1 });
                g.moveTo(-s * 0.7, -s * 0.3);
                g.lineTo(s * 0.7, s * 0.3);
                g.stroke({ color: 0xffffff, alpha: 0.2, width: 1 });
                g.rect(-4, -2, 3, 3).fill(0x000000);
                g.rect(1, -2, 3, 3).fill(0x000000);
                break;
            case 4: // Segmented shell
                for (let i = 0; i < 6; i++) {
                    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
                    const x1 = Math.cos(angle) * s * 0.4;
                    const y1 = Math.sin(angle) * s * 0.4;
                    const x2 = Math.cos(angle) * s * 0.8;
                    const y2 = Math.sin(angle) * s * 0.8;
                    g.moveTo(x1, y1);
                    g.lineTo(x2, y2);
                    g.stroke({ color: dark, width: 2 });
                }
                g.rect(-3, -2, 2, 2).fill(0x000000);
                g.rect(1, -2, 2, 2).fill(0x000000);
                break;
        }
    }

    // ========== Splitter Patterns ==========
    private drawSplitter(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Two connected blobs
        g.rect(-s, -s * 0.7, s * 0.9, s * 1.4).fill(color);
        g.rect(s * 0.1, -s * 0.7, s * 0.9, s * 1.4).fill(color);
        g.rect(-2, -s * 0.3, 4, s * 0.6).fill(dark);

        // Pattern variations
        switch (patternId) {
            case 0: // Plain with 4 eyes
                g.rect(-s * 0.7, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(-s * 0.4, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.3, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.6, -s * 0.2, 2, 2).fill(0x000000);
                break;
            case 1: // Split line
                g.rect(-0.5, -s * 0.6, 1, s * 1.2).fill(0x000000);
                g.rect(-s * 0.6, -s * 0.15, 2, 2).fill(0x000000);
                g.rect(s * 0.5, -s * 0.15, 2, 2).fill(0x000000);
                break;
            case 2: // Mitosis effect
                g.circle(-s * 0.5, 0, s * 0.35).stroke({ color: dark, width: 2 });
                g.circle(s * 0.5, 0, s * 0.35).stroke({ color: dark, width: 2 });
                g.rect(-s * 0.6, -s * 0.1, 2, 2).fill(0x000000);
                g.rect(s * 0.5, -s * 0.1, 2, 2).fill(0x000000);
                break;
            case 3: // Nucleus dots
                g.circle(-s * 0.5, 0, 3).fill(dark);
                g.circle(s * 0.5, 0, 3).fill(dark);
                g.rect(-s * 0.65, -s * 0.25, 2, 2).fill(0x000000);
                g.rect(s * 0.5, -s * 0.25, 2, 2).fill(0x000000);
                break;
            case 4: // Wavy border
                g.roundRect(-s * 1.05, -s * 0.75, s * 2.1, s * 1.5, 6).stroke({ color: dark, width: 2 });
                g.rect(-s * 0.7, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(-s * 0.4, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.3, -s * 0.2, 2, 2).fill(0x000000);
                g.rect(s * 0.6, -s * 0.2, 2, 2).fill(0x000000);
                break;
        }
    }

    // ========== Boss Patterns ==========
    private drawBoss(g: Graphics, color: number, dark: number, s: number, patternId: number) {
        // Base shape: Big scary skull-like
        g.rect(-s - 3, -s - 3, s * 2 + 6, s * 2 + 6).fill(dark);
        g.rect(-s, -s, s * 2, s * 2).fill(color);

        // Eye sockets
        g.rect(-s * 0.6, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);
        g.rect(s * 0.1, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);

        // Red glowing eyes
        g.rect(-s * 0.5, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);
        g.rect(s * 0.2, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);

        // Teeth
        for (let i = 0; i < 4; i++) {
            g.rect(-s * 0.6 + i * s * 0.35, s * 0.3, s * 0.25, s * 0.4).fill(0xffffff);
        }

        // Pattern variations (boss enhancements)
        switch (patternId) {
            case 0: // Plain menacing
                break;
            case 1: // Crown spikes
                for (let i = -2; i <= 2; i++) {
                    g.poly([
                        i * s * 0.3, -s - 3,
                        i * s * 0.3 - 4, -s - 10,
                        i * s * 0.3 + 4, -s - 10
                    ]).fill(dark);
                }
                break;
            case 2: // Aura rings
                g.circle(0, 0, s * 1.4).stroke({ color: 0xff0000, width: 2, alpha: 0.3 });
                g.circle(0, 0, s * 1.6).stroke({ color: 0xff0000, width: 1, alpha: 0.2 });
                break;
            case 3: // Scar marking
                g.moveTo(-s * 0.8, -s * 0.7);
                g.lineTo(s * 0.2, s * 0.5);
                g.stroke({ color: 0x220000, width: 4 });
                break;
            case 4: // Horns
                g.poly([
                    -s * 0.8, -s,
                    -s * 1.0, -s - 12,
                    -s * 0.4, -s
                ]).fill(0x442222);
                g.poly([
                    s * 0.8, -s,
                    s * 1.0, -s - 12,
                    s * 0.4, -s
                ]).fill(0x442222);
                break;
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

    /**
     * Game color palette for procedural variations.
     * Uses colors from ENEMY_DEFS and EMITTER_DEFS to keep variations cohesive.
     */
    private static readonly PALETTE_COLORS: number[] = [
        // Enemy colors
        0xcc4444, // grunt red
        0xcccc44, // fast yellow
        0x6644aa, // tank purple
        0x44aa66, // shielded green
        0xff88ff, // splitter pink
        0x882222, // boss dark red
        // Emitter colors (complementary)
        0x4488ff, // water blue
        0xff6622, // fire orange
        0xffff44, // electric yellow
        0x44ff66, // goo green
    ];

    /**
     * Shift color by variation amount using palette-based blending.
     * Instead of arbitrary brightness shifts, we blend towards nearby palette colors
     * to keep variations within the game's aesthetic.
     */
    private shiftColor(color: number, shift: number): number {
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;

        // For small shifts, just adjust saturation/brightness slightly
        if (Math.abs(shift) <= 10) {
            const factor = 1 + shift / 150; // More subtle adjustment
            return (
                (Math.min(255, Math.max(0, Math.round(r * factor))) << 16) |
                (Math.min(255, Math.max(0, Math.round(g * factor))) << 8) |
                Math.min(255, Math.max(0, Math.round(b * factor)))
            );
        }

        // For larger shifts, blend towards a palette color
        // Pick a palette color based on the shift value
        const paletteIndex = Math.abs(shift) % EnemyRenderer.PALETTE_COLORS.length;
        const paletteColor = EnemyRenderer.PALETTE_COLORS[paletteIndex];
        const pr = (paletteColor >> 16) & 0xff;
        const pg = (paletteColor >> 8) & 0xff;
        const pb = paletteColor & 0xff;

        // Blend factor: 15-25% towards palette color for subtle variation
        const blendFactor = 0.15 + (Math.abs(shift) % 10) / 100;

        const nr = Math.round(r + (pr - r) * blendFactor);
        const ng = Math.round(g + (pg - g) * blendFactor);
        const nb = Math.round(b + (pb - b) * blendFactor);

        return (
            (Math.min(255, Math.max(0, nr)) << 16) |
            (Math.min(255, Math.max(0, ng)) << 8) |
            Math.min(255, Math.max(0, nb))
        );
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
