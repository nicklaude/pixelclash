/**
 * Projectile Renderer
 *
 * High-performance projectile rendering using PixiJS ParticleContainer.
 * Bridges ECS projectile data with GPU-batched rendering.
 *
 * Features:
 * - Uses ParticleContainer for single draw call batching
 * - Pre-generated texture atlas with tinting
 * - Trail effects for visual polish
 * - Zero per-frame allocations
 */

import { Container, ParticleContainer, Particle, Texture, Graphics, Application } from 'pixi.js';
import { ProjectileArrays, DeathParticleArrays, PROJECTILE_TYPE_REVERSE } from './types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config';

// Trail point for projectile trails
interface TrailPoint {
    x: number;
    y: number;
    alpha: number;
}

// Per-projectile rendering state
interface ProjectileRenderState {
    particle: Particle | null;
    trail: TrailPoint[];
    trailParticles: Particle[];
}

// Per-death-particle rendering state
interface DeathParticleRenderState {
    particle: Particle | null;
}

// Texture cache
const textureCache: Map<string, Texture> = new Map();

/**
 * Generate a WHITE particle texture for tinting
 */
function generateParticleTexture(
    app: Application,
    size: number,
    type: 'square' | 'circle' | 'glow' = 'square'
): Texture {
    const key = `${type}-${size}`;
    if (textureCache.has(key)) {
        return textureCache.get(key)!;
    }

    const graphics = new Graphics();
    const padding = type === 'glow' ? size : 2;
    const totalSize = size + padding * 2;

    if (type === 'glow') {
        graphics.circle(totalSize / 2, totalSize / 2, size)
            .fill({ color: 0xffffff, alpha: 0.3 });
        graphics.rect(totalSize / 2 - size / 4, totalSize / 2 - size / 4, size / 2, size / 2)
            .fill(0xffffff);
    } else if (type === 'circle') {
        graphics.circle(totalSize / 2, totalSize / 2, size / 2)
            .fill(0xffffff);
    } else {
        graphics.rect(padding, padding, size, size)
            .fill(0xffffff);
        const innerSize = size * 0.5;
        const innerOffset = (size - innerSize) / 2 + padding;
        graphics.rect(innerOffset, innerOffset, innerSize, innerSize)
            .fill(0xeeeeee);
    }

    const texture = app.renderer.generateTexture({
        target: graphics,
        resolution: 2,
    });

    textureCache.set(key, texture);
    graphics.destroy();

    return texture;
}

/**
 * High-performance projectile renderer using ECS data
 */
export class ProjectileRenderer {
    private app: Application;

    // Particle containers for batched rendering
    private projectileContainer: ParticleContainer;
    private trailContainer: ParticleContainer;
    private deathContainer: ParticleContainer;

    // Per-entity render state (maps array index to render objects)
    private projectileStates: ProjectileRenderState[] = [];
    private deathParticleStates: DeathParticleRenderState[] = [];

    // Cached textures
    private squareTextures: Map<number, Texture> = new Map();
    private glowTexture: Texture | null = null;
    private circleTexture: Texture | null = null;

    // Trail configuration
    private readonly TRAIL_LENGTH = 8;

    constructor(app: Application) {
        this.app = app;

        // Create particle containers with optimized dynamic properties
        this.projectileContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: false,
                rotation: false,
                color: false,
            },
        });

        this.trailContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: true,
                color: true,
            },
        });

        this.deathContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: true,
                color: true,
            },
        });

        // Pre-generate common textures
        this.glowTexture = generateParticleTexture(app, 5, 'glow');
        this.circleTexture = generateParticleTexture(app, 4, 'circle');
    }

    /**
     * Get the container to add to the stage
     */
    getContainer(): Container {
        const container = new Container();
        container.addChild(this.trailContainer, this.projectileContainer, this.deathContainer);
        return container;
    }

    /**
     * Get or create a square texture of given size
     */
    private getSquareTexture(size: number): Texture {
        let texture = this.squareTextures.get(size);
        if (!texture) {
            texture = generateParticleTexture(this.app, size, 'square');
            this.squareTextures.set(size, texture);
        }
        return texture;
    }

    /**
     * Sync projectile rendering with ECS data
     */
    syncProjectiles(projectiles: ProjectileArrays): void {
        // Ensure we have enough render states
        while (this.projectileStates.length < projectiles.count) {
            this.projectileStates.push({
                particle: null,
                trail: [],
                trailParticles: [],
            });
        }

        // Update each projectile
        for (let i = 0; i < projectiles.count; i++) {
            const state = this.projectileStates[i];
            const size = projectiles.size[i];
            const color = projectiles.color[i];
            const typeId = projectiles.type[i];
            const typeName = PROJECTILE_TYPE_REVERSE[typeId];

            // Create particle if needed
            if (!state.particle) {
                const texture = typeName === 'electric'
                    ? this.glowTexture!
                    : this.getSquareTexture(size);

                state.particle = new Particle({
                    texture,
                    x: projectiles.x[i],
                    y: projectiles.y[i],
                    anchorX: 0.5,
                    anchorY: 0.5,
                    tint: color,
                });
                this.projectileContainer.addParticle(state.particle);
            }

            // Update position
            state.particle.x = projectiles.x[i];
            state.particle.y = projectiles.y[i];

            // Update trail
            this.updateTrail(state, projectiles.x[i], projectiles.y[i], size, color);
        }

        // Hide/remove excess projectile states
        for (let i = projectiles.count; i < this.projectileStates.length; i++) {
            const state = this.projectileStates[i];
            if (state.particle) {
                this.projectileContainer.removeParticle(state.particle);
                state.particle = null;
            }
            // Clear trail
            for (const tp of state.trailParticles) {
                this.trailContainer.removeParticle(tp);
            }
            state.trail.length = 0;
            state.trailParticles.length = 0;
        }

        // Trim states array
        this.projectileStates.length = projectiles.count;
    }

    /**
     * Update trail for a projectile
     */
    private updateTrail(
        state: ProjectileRenderState,
        x: number,
        y: number,
        size: number,
        color: number
    ): void {
        // Add new trail point
        if (state.trail.length < this.TRAIL_LENGTH) {
            state.trail.unshift({ x, y, alpha: 0.5 });

            // Create trail particle
            const trailTexture = this.getSquareTexture(Math.max(2, size - 1));
            const trailParticle = new Particle({
                texture: trailTexture,
                x,
                y,
                anchorX: 0.5,
                anchorY: 0.5,
                alpha: 0.5,
                tint: color,
            });
            state.trailParticles.unshift(trailParticle);
            this.trailContainer.addParticle(trailParticle);
        } else {
            // Reuse existing trail points
            state.trail.pop();
            state.trail.unshift({ x, y, alpha: 0.5 });
        }

        // Update trail particles
        for (let j = 0; j < state.trail.length && j < state.trailParticles.length; j++) {
            const tp = state.trail[j];
            const particle = state.trailParticles[j];
            const progress = j / state.trail.length;

            particle.x = tp.x;
            particle.y = tp.y;
            particle.alpha = 0.5 * (1 - progress);
            particle.scaleX = 1 - progress * 0.5;
            particle.scaleY = particle.scaleX;
        }
    }

    /**
     * Sync death particle rendering with ECS data
     */
    syncDeathParticles(particles: DeathParticleArrays): void {
        // Ensure we have enough render states
        while (this.deathParticleStates.length < particles.count) {
            this.deathParticleStates.push({ particle: null });
        }

        // Update each particle
        for (let i = 0; i < particles.count; i++) {
            const state = this.deathParticleStates[i];
            const size = particles.size[i];
            const color = particles.color[i];
            const life = particles.life[i];
            const maxLife = particles.maxLife[i];

            // Create particle if needed
            if (!state.particle) {
                const texture = this.getSquareTexture(Math.ceil(size));
                state.particle = new Particle({
                    texture,
                    x: particles.x[i],
                    y: particles.y[i],
                    anchorX: 0.5,
                    anchorY: 0.5,
                    tint: color,
                });
                this.deathContainer.addParticle(state.particle);
            }

            // Update position and appearance
            state.particle.x = particles.x[i];
            state.particle.y = particles.y[i];
            state.particle.alpha = Math.min(1, life * 2);
            state.particle.scaleX = size / 4;
            state.particle.scaleY = size / 4;
            state.particle.tint = color;
        }

        // Remove excess particles
        for (let i = particles.count; i < this.deathParticleStates.length; i++) {
            const state = this.deathParticleStates[i];
            if (state.particle) {
                this.deathContainer.removeParticle(state.particle);
                state.particle = null;
            }
        }

        // Trim states array
        this.deathParticleStates.length = particles.count;
    }

    /**
     * Called when a projectile is removed (index changed due to swap-remove)
     * This is handled automatically by sync, but we need to clean up trails
     */
    onProjectileRemoved(index: number): void {
        if (index < this.projectileStates.length) {
            const state = this.projectileStates[index];
            if (state.particle) {
                this.projectileContainer.removeParticle(state.particle);
                state.particle = null;
            }
            for (const tp of state.trailParticles) {
                this.trailContainer.removeParticle(tp);
            }
            state.trail.length = 0;
            state.trailParticles.length = 0;
        }
    }

    /**
     * Clear all rendering state
     */
    clear(): void {
        // Clear projectile states
        for (const state of this.projectileStates) {
            if (state.particle) {
                this.projectileContainer.removeParticle(state.particle);
            }
            for (const tp of state.trailParticles) {
                this.trailContainer.removeParticle(tp);
            }
        }
        this.projectileStates.length = 0;

        // Clear death particle states
        for (const state of this.deathParticleStates) {
            if (state.particle) {
                this.deathContainer.removeParticle(state.particle);
            }
        }
        this.deathParticleStates.length = 0;
    }

    /**
     * Destroy all resources
     */
    destroy(): void {
        this.clear();
        this.projectileContainer.destroy();
        this.trailContainer.destroy();
        this.deathContainer.destroy();
    }
}
