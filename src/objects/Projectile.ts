import { Container, Graphics } from 'pixi.js';
import { ParticleData, ParticleType, Vec2 } from '../types';
import { PARTICLE_TRAIL_LENGTH } from '../config';

export class Projectile extends Container {
    data_: ParticleData;
    velocity: Vec2;
    trail: Vec2[] = [];
    graphics: Graphics;
    trailGraphics: Graphics;
    color: number;
    size: number;

    constructor(
        x: number,
        y: number,
        vx: number,
        vy: number,
        id: number,
        type: ParticleType,
        damage: number,
        pierce: number,
        lifespan: number,
        knockbackForce: number,
        color: number,
        size: number
    ) {
        super();
        this.position.set(x, y);
        this.velocity = { x: vx, y: vy };
        this.color = color;
        this.size = size;

        this.data_ = {
            id,
            damage,
            pierce,
            lifespan,
            type,
            knockbackForce,
            hitEnemies: new Set(),
            sourceEmitterId: 0,
        };

        this.trailGraphics = new Graphics();
        this.graphics = new Graphics();
        this.addChild(this.trailGraphics, this.graphics);

        this.draw();
    }

    draw() {
        this.graphics.clear();

        // Main particle (pixel style)
        this.graphics.rect(-this.size / 2, -this.size / 2, this.size, this.size)
            .fill(this.color);

        // Bright center
        const innerSize = this.size * 0.5;
        this.graphics.rect(-innerSize / 2, -innerSize / 2, innerSize, innerSize)
            .fill(this.lightenColor(this.color, 0.5));

        // Electric glow
        if (this.data_.type === 'electric') {
            this.graphics.circle(0, 0, this.size)
                .fill({ color: 0xffffaa, alpha: 0.3 });
        }
    }

    drawTrail() {
        this.trailGraphics.clear();

        for (let i = 0; i < this.trail.length; i++) {
            const alpha = 0.5 * (1 - i / this.trail.length);
            const size = this.size * (1 - i / this.trail.length * 0.5);

            // Trail position relative to current position
            const tx = this.trail[i].x - this.x;
            const ty = this.trail[i].y - this.y;

            this.trailGraphics.rect(tx - size / 2, ty - size / 2, size, size)
                .fill({ color: this.color, alpha });
        }
    }

    update(dt: number): boolean {
        // Store position for trail
        this.trail.unshift({ x: this.x, y: this.y });
        if (this.trail.length > PARTICLE_TRAIL_LENGTH) {
            this.trail.pop();
        }

        // Update position
        this.x += this.velocity.x * dt;
        this.y += this.velocity.y * dt;

        // Lifespan
        this.data_.lifespan -= dt;

        // Draw trail
        this.drawTrail();

        return this.data_.lifespan > 0 && this.data_.pierce > 0;
    }

    hasHitEnemy(enemyId: number): boolean {
        return this.data_.hitEnemies.has(enemyId);
    }

    registerHit(enemyId: number) {
        this.data_.hitEnemies.add(enemyId);
        this.data_.pierce--;
    }

    isAlive(): boolean {
        return this.data_.lifespan > 0 && this.data_.pierce > 0;
    }

    private lightenColor(color: number, factor: number): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }
}
