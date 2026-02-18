/**
 * Optimized Particle System using PixiJS v8 ParticleContainer
 *
 * Performance optimizations:
 * 1. Uses ParticleContainer for batched GPU rendering (single draw call)
 * 2. Object pooling to avoid GC pressure
 * 3. Sprite-based rendering instead of per-frame Graphics redraws
 * 4. Pre-generated texture atlas for all particle types
 * 5. Proper culling with bounds checking
 */
import { Container, ParticleContainer, Particle, Texture, Graphics, RenderTexture, Application } from 'pixi.js';
import { ParticlePool } from './ParticlePool';
import { ParticleType, Vec2 } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, UI_TOP_HEIGHT, PARTICLE_TRAIL_LENGTH } from '../config';

// Trail point for projectile trails
interface TrailPoint {
    x: number;
    y: number;
    alpha: number;
    scale: number;
}

// Projectile data optimized for pooling
export interface ProjectileData {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    pierce: number;
    lifespan: number;
    maxLifespan: number;
    type: ParticleType;
    knockbackForce: number;
    hitEnemies: Set<number>;
    sourceEmitterId: number;
    color: number;
    size: number;
    particle: Particle | null;
    trail: TrailPoint[];
    trailParticles: Particle[];
    active: boolean;
}

// Death particle (simple visual effect)
export interface DeathParticleData {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: number;
    size: number;
    life: number;
    maxLife: number;
    particle: Particle | null;
    active: boolean;
}

// Texture cache for particle types - use WHITE base textures for tinting
const textureCache: Map<string, Texture> = new Map();

/**
 * Generate a WHITE particle texture for tinting
 * In PixiJS v8 ParticleContainer, we should use tint property on particles
 * rather than baking color into texture for better batching
 */
function generateParticleTexture(app: Application, size: number, type: 'square' | 'circle' | 'glow' = 'square'): Texture {
    // Key only by type and size - color will be applied via tint
    const key = `${type}-${size}`;
    if (textureCache.has(key)) {
        return textureCache.get(key)!;
    }

    const graphics = new Graphics();
    const padding = type === 'glow' ? size : 2;
    const totalSize = size + padding * 2;

    if (type === 'glow') {
        // Electric glow effect - white base with glow
        graphics.circle(totalSize / 2, totalSize / 2, size)
            .fill({ color: 0xffffff, alpha: 0.3 });
        graphics.rect(totalSize / 2 - size / 4, totalSize / 2 - size / 4, size / 2, size / 2)
            .fill(0xffffff);
    } else if (type === 'circle') {
        // Circle particle for death effects - white
        graphics.circle(totalSize / 2, totalSize / 2, size / 2)
            .fill(0xffffff);
    } else {
        // Square pixel-style particle - white base
        graphics.rect(padding, padding, size, size)
            .fill(0xffffff);
        // Bright center (slightly less bright for contrast when tinted)
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

function lightenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
    const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
    const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
    return (r << 16) | (g << 8) | b;
}

/**
 * High-performance particle system for projectiles and effects
 */
export class ParticleSystem {
    private app: Application;

    // Containers for different particle types
    private projectileContainer: ParticleContainer;
    private trailContainer: ParticleContainer;
    private deathContainer: ParticleContainer;

    // Active particles
    private projectiles: ProjectileData[] = [];
    private deathParticles: DeathParticleData[] = [];

    // Object pools
    private projectilePool: ParticlePool<ProjectileData>;
    private deathParticlePool: ParticlePool<DeathParticleData>;

    // Cached textures
    private trailTexture: Texture | null = null;
    private deathTexture: Texture | null = null;

    // Bounds for culling
    private readonly minX = -50;
    private readonly maxX = CANVAS_WIDTH + 50;
    private readonly minY = -50;
    private readonly maxY = CANVAS_HEIGHT + 50;

    // Next ID counter
    private nextId = 1;

    constructor(app: Application) {
        this.app = app;

        // Create particle containers with optimized dynamic properties
        // Only position is dynamic for projectiles (updated every frame)
        this.projectileContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: false,
                rotation: false,
                color: false,
            },
        });

        // Trail particles need position and alpha (for fading)
        this.trailContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: true,
                color: true, // For alpha changes
            },
        });

        // Death particles need position, scale, and alpha
        this.deathContainer = new ParticleContainer({
            dynamicProperties: {
                position: true,
                scale: true,
                color: true,
            },
        });

        // Initialize object pools
        this.projectilePool = new ParticlePool<ProjectileData>(
            () => this.createProjectileData(),
            (p) => this.resetProjectileData(p),
            200, // Initial pool size
            1000 // Max pool size
        );

        this.deathParticlePool = new ParticlePool<DeathParticleData>(
            () => this.createDeathParticleData(),
            (p) => this.resetDeathParticleData(p),
            100,
            500
        );

        // Generate default textures (white base for tinting)
        this.trailTexture = generateParticleTexture(app, 4, 'square');
        this.deathTexture = generateParticleTexture(app, 4, 'circle');
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
     * Spawn a new projectile
     */
    spawnProjectile(
        x: number,
        y: number,
        vx: number,
        vy: number,
        type: ParticleType,
        damage: number,
        pierce: number,
        lifespan: number,
        knockbackForce: number,
        color: number,
        size: number,
        sourceEmitterId: number
    ): ProjectileData {
        const proj = this.projectilePool.acquire();

        proj.id = this.nextId++;
        proj.x = x;
        proj.y = y;
        proj.vx = vx;
        proj.vy = vy;
        proj.type = type;
        proj.damage = damage;
        proj.pierce = pierce;
        proj.lifespan = lifespan;
        proj.maxLifespan = lifespan;
        proj.knockbackForce = knockbackForce;
        proj.color = color;
        proj.size = size;
        proj.sourceEmitterId = sourceEmitterId;
        proj.hitEnemies.clear();
        proj.active = true;

        // Create particle with WHITE texture, apply color via tint
        const texture = generateParticleTexture(this.app, size, type === 'electric' ? 'glow' : 'square');
        proj.particle = new Particle({
            texture,
            x,
            y,
            anchorX: 0.5,
            anchorY: 0.5,
            tint: color,  // Apply color via tint for proper batching
        });

        this.projectileContainer.addParticle(proj.particle);
        this.projectiles.push(proj);

        return proj;
    }

    /**
     * Spawn death explosion particles
     */
    spawnDeathExplosion(x: number, y: number, color: number, size: number): void {
        const count = Math.floor(8 + size * 0.5);

        for (let i = 0; i < count; i++) {
            const particle = this.deathParticlePool.acquire();

            const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
            const speed = 80 + Math.random() * 120;

            particle.x = x + (Math.random() - 0.5) * size;
            particle.y = y + (Math.random() - 0.5) * size;
            particle.vx = Math.cos(angle) * speed;
            particle.vy = Math.sin(angle) * speed - 50;
            particle.color = Math.random() > 0.3 ? color : lightenColor(color, 0.5);
            particle.size = 3 + Math.random() * 4;
            particle.life = 0.5 + Math.random() * 0.5;
            particle.maxLife = particle.life;
            particle.active = true;

            // Create pixi particle with tint for color
            const texture = generateParticleTexture(this.app, Math.ceil(particle.size), 'square');
            particle.particle = new Particle({
                texture,
                x: particle.x,
                y: particle.y,
                anchorX: 0.5,
                anchorY: 0.5,
                tint: particle.color,  // Apply color via tint
            });

            this.deathContainer.addParticle(particle.particle);
            this.deathParticles.push(particle);
        }
    }

    /**
     * Update all particles - call this every frame
     */
    update(dt: number): void {
        this.updateProjectiles(dt);
        this.updateDeathParticles(dt);
    }

    private updateProjectiles(dt: number): void {
        const toRemove: ProjectileData[] = [];

        for (const proj of this.projectiles) {
            if (!proj.active) continue;

            // Store position for trail
            if (proj.trail.length < PARTICLE_TRAIL_LENGTH) {
                // Add trail point
                const trailPoint: TrailPoint = {
                    x: proj.x,
                    y: proj.y,
                    alpha: 0.5,
                    scale: 1,
                };
                proj.trail.unshift(trailPoint);

                // Create trail particle with tint for color
                const trailTexture = generateParticleTexture(this.app, Math.max(2, proj.size - 1), 'square');
                const trailParticle = new Particle({
                    texture: trailTexture,
                    x: trailPoint.x,
                    y: trailPoint.y,
                    anchorX: 0.5,
                    anchorY: 0.5,
                    alpha: trailPoint.alpha,
                    tint: proj.color,  // Use same color as projectile
                });
                proj.trailParticles.unshift(trailParticle);
                this.trailContainer.addParticle(trailParticle);
            } else {
                // Update existing trail
                proj.trail.unshift({ x: proj.x, y: proj.y, alpha: 0.5, scale: 1 });
                proj.trail.pop();
            }

            // Update trail particles
            for (let i = 0; i < proj.trail.length && i < proj.trailParticles.length; i++) {
                const tp = proj.trail[i];
                const particle = proj.trailParticles[i];
                const progress = i / proj.trail.length;

                particle.x = tp.x;
                particle.y = tp.y;
                particle.alpha = 0.5 * (1 - progress);
                particle.scaleX = proj.size * (1 - progress * 0.5) / proj.size;
                particle.scaleY = particle.scaleX;
            }

            // Update position
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;

            // Update lifespan
            proj.lifespan -= dt;

            // Update pixi particle position
            if (proj.particle) {
                proj.particle.x = proj.x;
                proj.particle.y = proj.y;
            }

            // Check if dead or out of bounds
            const outOfBounds = proj.x < this.minX || proj.x > this.maxX ||
                                proj.y < this.minY || proj.y > this.maxY;

            if (proj.lifespan <= 0 || proj.pierce <= 0 || outOfBounds) {
                toRemove.push(proj);
            }
        }

        // Remove dead projectiles
        for (const proj of toRemove) {
            this.removeProjectile(proj);
        }
    }

    private updateDeathParticles(dt: number): void {
        const toRemove: DeathParticleData[] = [];

        for (const p of this.deathParticles) {
            if (!p.active) continue;

            // Physics
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 200 * dt; // Gravity
            p.life -= dt;
            p.size *= 0.98;

            // Update pixi particle
            if (p.particle) {
                p.particle.x = p.x;
                p.particle.y = p.y;
                p.particle.alpha = Math.min(1, p.life * 2);
                p.particle.scaleX = p.size / 4;
                p.particle.scaleY = p.size / 4;
            }

            if (p.life <= 0 || p.size < 0.5) {
                toRemove.push(p);
            }
        }

        // Remove dead particles
        for (const p of toRemove) {
            this.removeDeathParticle(p);
        }
    }

    /**
     * Remove a projectile and return it to the pool
     */
    removeProjectile(proj: ProjectileData): void {
        proj.active = false;

        // Remove main particle
        if (proj.particle) {
            this.projectileContainer.removeParticle(proj.particle);
            proj.particle = null;
        }

        // Remove trail particles
        for (const tp of proj.trailParticles) {
            this.trailContainer.removeParticle(tp);
        }
        proj.trailParticles.length = 0;
        proj.trail.length = 0;

        // Remove from active list
        const idx = this.projectiles.indexOf(proj);
        if (idx !== -1) {
            this.projectiles.splice(idx, 1);
        }

        // Return to pool
        this.projectilePool.release(proj);
    }

    private removeDeathParticle(p: DeathParticleData): void {
        p.active = false;

        if (p.particle) {
            this.deathContainer.removeParticle(p.particle);
            p.particle = null;
        }

        const idx = this.deathParticles.indexOf(p);
        if (idx !== -1) {
            this.deathParticles.splice(idx, 1);
        }

        this.deathParticlePool.release(p);
    }

    /**
     * Get all active projectiles for collision detection
     */
    getProjectiles(): ProjectileData[] {
        return this.projectiles;
    }

    /**
     * Check if projectile has hit an enemy
     */
    hasHitEnemy(proj: ProjectileData, enemyId: number): boolean {
        return proj.hitEnemies.has(enemyId);
    }

    /**
     * Register a hit on an enemy
     */
    registerHit(proj: ProjectileData, enemyId: number): void {
        proj.hitEnemies.add(enemyId);
        proj.pierce--;
    }

    /**
     * Get projectile count for performance monitoring
     */
    get projectileCount(): number {
        return this.projectiles.length;
    }

    /**
     * Get death particle count for performance monitoring
     */
    get deathParticleCount(): number {
        return this.deathParticles.length;
    }

    // Pool factory/reset methods
    private createProjectileData(): ProjectileData {
        return {
            id: 0,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            damage: 0,
            pierce: 0,
            lifespan: 0,
            maxLifespan: 0,
            type: 'water',
            knockbackForce: 0,
            hitEnemies: new Set(),
            sourceEmitterId: 0,
            color: 0xffffff,
            size: 3,
            particle: null,
            trail: [],
            trailParticles: [],
            active: false,
        };
    }

    private resetProjectileData(p: ProjectileData): void {
        p.id = 0;
        p.x = 0;
        p.y = 0;
        p.vx = 0;
        p.vy = 0;
        p.damage = 0;
        p.pierce = 0;
        p.lifespan = 0;
        p.maxLifespan = 0;
        p.knockbackForce = 0;
        p.hitEnemies.clear();
        p.sourceEmitterId = 0;
        p.particle = null;
        p.trail.length = 0;
        p.trailParticles.length = 0;
        p.active = false;
    }

    private createDeathParticleData(): DeathParticleData {
        return {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            color: 0xffffff,
            size: 3,
            life: 0,
            maxLife: 0,
            particle: null,
            active: false,
        };
    }

    private resetDeathParticleData(p: DeathParticleData): void {
        p.x = 0;
        p.y = 0;
        p.vx = 0;
        p.vy = 0;
        p.size = 3;
        p.life = 0;
        p.maxLife = 0;
        p.particle = null;
        p.active = false;
    }

    /**
     * Clean up all resources
     */
    destroy(): void {
        // Remove all particles
        for (const proj of [...this.projectiles]) {
            this.removeProjectile(proj);
        }
        for (const p of [...this.deathParticles]) {
            this.removeDeathParticle(p);
        }

        // Destroy containers
        this.projectileContainer.destroy();
        this.trailContainer.destroy();
        this.deathContainer.destroy();
    }
}
