import { Container, Graphics } from 'pixi.js';
import { EnemyData, EnemyType, Vec2 } from '../types';
import { ENEMY_DEFS, KNOCKBACK_VELOCITY_THRESHOLD } from '../config';

export class Enemy extends Container {
    data_: EnemyData;
    worldPath: Vec2[];
    velocity: Vec2 = { x: 0, y: 0 };
    graphics: Graphics;
    healthBar: Graphics;

    constructor(
        x: number,
        y: number,
        id: number,
        type: EnemyType,
        worldPath: Vec2[],
        waveNum: number,
        scale: number = 1
    ) {
        super();
        this.position.set(x, y);
        this.worldPath = worldPath;

        const def = ENEMY_DEFS[type];
        const healthScale = 1 + (waveNum - 1) * 0.2;
        const scaledHealth = Math.round(def.health * healthScale * scale);

        this.data_ = {
            id,
            type,
            health: scaledHealth,
            maxHealth: scaledHealth,
            baseSpeed: def.speed * scale,
            mass: def.mass * scale,
            friction: def.friction,
            pathIndex: 0,
            pathProgress: 0,
            slowTimer: 0,
            slowFactor: 1,
            dotTimer: 0,
            dotDamage: 0,
            reward: Math.round(def.reward * scale),
            flashTimer: 0,
        };

        // If spawning mid-path, find nearest path index
        if (x !== worldPath[0].x || y !== worldPath[0].y) {
            let nearestIdx = 0;
            let nearestDist = Infinity;
            for (let i = 0; i < worldPath.length; i++) {
                const dx = worldPath[i].x - x;
                const dy = worldPath[i].y - y;
                const d = dx * dx + dy * dy;
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestIdx = i;
                }
            }
            this.data_.pathIndex = nearestIdx;
        }

        this.graphics = new Graphics();
        this.healthBar = new Graphics();
        this.addChild(this.graphics, this.healthBar);

        this.draw();
    }

    draw() {
        const g = this.graphics;
        g.clear();

        const def = ENEMY_DEFS[this.data_.type];
        const s = def.size;
        let color = def.color;

        // Flash effect
        if (this.data_.flashTimer > 0) {
            color = 0xffffff;
        }

        const dark = this.darkenColor(color, 0.5);
        const type = this.data_.type;

        // DOT fire effect
        if (this.data_.dotTimer > 0) {
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
        if (type === 'grunt') {
            // Angry square with spikes
            g.rect(-s, -s, s * 2, s * 2).fill(color);
            // Corner spikes
            g.rect(-s - 3, -s - 3, 4, 4).fill(dark);
            g.rect(s - 1, -s - 3, 4, 4).fill(dark);
            g.rect(-s - 3, s - 1, 4, 4).fill(dark);
            g.rect(s - 1, s - 1, 4, 4).fill(dark);
            // Angry eyes
            g.rect(-s * 0.5, -s * 0.3, 3, 4).fill(0x000000);
            g.rect(s * 0.2, -s * 0.3, 3, 4).fill(0x000000);
            // Angry mouth
            g.rect(-s * 0.4, s * 0.3, s * 0.8, 2).fill(0x000000);
        } else if (type === 'fast') {
            // Diamond/arrow shape
            g.poly([0, -s, s, 0, 0, s * 0.7, -s, 0]).fill(color);
            // Speed lines
            g.rect(-s - 6, -1, 4, 2).fill({ color: dark, alpha: 0.6 });
            g.rect(-s - 10, 3, 3, 2).fill({ color: dark, alpha: 0.6 });
            // Eye
            g.rect(-2, -s * 0.3, 4, 3).fill(0x000000);
        } else if (type === 'tank') {
            // Big chunky square with armor plates
            g.rect(-s - 2, -s - 2, s * 2 + 4, s * 2 + 4).fill(dark);
            g.rect(-s, -s, s * 2, s * 2).fill(color);
            // Armor plates
            g.rect(-s + 2, -s + 2, s - 2, s - 2).fill(this.lightenColor(color, 0.3));
            // Visor
            g.rect(-s * 0.6, -s * 0.2, s * 1.2, 4).fill(0x222222);
            g.rect(-s * 0.5, -s * 0.1, s, 2).fill({ color: 0x44ffff, alpha: 0.8 });
        } else if (type === 'shielded') {
            // Hexagon-ish shape
            g.poly([
                -s * 0.5, -s,
                s * 0.5, -s,
                s, 0,
                s * 0.5, s,
                -s * 0.5, s,
                -s, 0
            ]).fill(color);
            // Shield shimmer
            g.rect(-s * 0.3, -s * 0.8, 3, s * 0.6).fill({ color: 0xffffff, alpha: 0.3 });
            // Eyes
            g.rect(-4, -2, 3, 3).fill(0x000000);
            g.rect(1, -2, 3, 3).fill(0x000000);
        } else if (type === 'splitter') {
            // Two connected blobs
            g.rect(-s, -s * 0.7, s * 0.9, s * 1.4).fill(color);
            g.rect(s * 0.1, -s * 0.7, s * 0.9, s * 1.4).fill(color);
            // Connection
            g.rect(-2, -s * 0.3, 4, s * 0.6).fill(dark);
            // Four eyes
            g.rect(-s * 0.7, -s * 0.2, 2, 2).fill(0x000000);
            g.rect(-s * 0.4, -s * 0.2, 2, 2).fill(0x000000);
            g.rect(s * 0.3, -s * 0.2, 2, 2).fill(0x000000);
            g.rect(s * 0.6, -s * 0.2, 2, 2).fill(0x000000);
        } else if (type === 'boss') {
            // Big scary boss - skull-like
            g.rect(-s - 3, -s - 3, s * 2 + 6, s * 2 + 6).fill(dark);
            g.rect(-s, -s, s * 2, s * 2).fill(color);
            // Eye sockets
            g.rect(-s * 0.6, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);
            g.rect(s * 0.1, -s * 0.5, s * 0.5, s * 0.6).fill(0x000000);
            // Glowing eyes
            g.rect(-s * 0.5, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);
            g.rect(s * 0.2, -s * 0.3, s * 0.3, s * 0.3).fill(0xff0000);
            // Teeth
            for (let i = 0; i < 4; i++) {
                g.rect(-s * 0.6 + i * s * 0.35, s * 0.3, s * 0.25, s * 0.4).fill(0xffffff);
            }
        } else {
            // Fallback
            g.rect(-s, -s, s * 2, s * 2).fill(color);
        }
    }

    drawHealthBar() {
        const def = ENEMY_DEFS[this.data_.type];
        const barWidth = Math.max(16, def.size * 1.2);
        const barHeight = 3;
        const barY = -def.size - 6;
        const healthPct = Math.max(0, this.data_.health / this.data_.maxHealth);

        this.healthBar.clear();

        // Only show if damaged
        if (healthPct >= 1) return;

        // Background
        this.healthBar.rect(-barWidth / 2, barY, barWidth, barHeight)
            .fill({ color: 0x222222, alpha: 0.8 });

        // Health
        let healthColor = 0x44ff44;
        if (healthPct < 0.5) healthColor = 0xffcc00;
        if (healthPct < 0.25) healthColor = 0xff4444;
        this.healthBar.rect(-barWidth / 2, barY, barWidth * healthPct, barHeight)
            .fill(healthColor);

        // Border
        this.healthBar.rect(-barWidth / 2, barY, barWidth, barHeight)
            .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
    }

    update(dt: number): boolean {
        const def = ENEMY_DEFS[this.data_.type];

        // Flash timer
        if (this.data_.flashTimer > 0) {
            this.data_.flashTimer -= dt;
        }

        // DOT damage
        if (this.data_.dotTimer > 0) {
            this.data_.dotTimer -= dt;
            this.data_.health -= this.data_.dotDamage * dt;
            if (this.data_.health <= 0) {
                return false;
            }
        }

        // Apply friction to knockback velocity
        const frictionFactor = Math.pow(this.data_.friction, dt * 60);
        this.velocity.x *= frictionFactor;
        this.velocity.y *= frictionFactor;

        // Clear very small velocities
        if (Math.abs(this.velocity.x) < 1) this.velocity.x = 0;
        if (Math.abs(this.velocity.y) < 1) this.velocity.y = 0;

        // Apply velocity
        this.x += this.velocity.x * dt;
        this.y += this.velocity.y * dt;

        // Path following (when not being knocked back)
        const knockbackSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);

        if (knockbackSpeed < KNOCKBACK_VELOCITY_THRESHOLD) {
            const currentTarget = this.worldPath[this.data_.pathIndex + 1];
            if (!currentTarget) {
                return false; // Reached nexus
            }

            const speedMult = this.data_.slowTimer > 0 ? this.data_.slowFactor : 1;
            this.data_.slowTimer = Math.max(0, this.data_.slowTimer - dt);

            const dx = currentTarget.x - this.x;
            const dy = currentTarget.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const moveSpeed = this.data_.baseSpeed * speedMult;

            if (dist < 2) {
                this.position.set(currentTarget.x, currentTarget.y);
                this.data_.pathIndex++;
            } else {
                const nx = dx / dist;
                const ny = dy / dist;
                this.x += nx * moveSpeed * dt;
                this.y += ny * moveSpeed * dt;
            }
        }

        // Reset slow factor
        this.data_.slowFactor = 1;

        // Redraw
        this.draw();
        this.drawHealthBar();

        if (this.data_.health <= 0) {
            return false;
        }

        return true;
    }

    applyKnockback(forceX: number, forceY: number) {
        const knockbackMult = 1 / this.data_.mass;
        this.velocity.x += forceX * knockbackMult;
        this.velocity.y += forceY * knockbackMult;
    }

    takeDamage(damage: number): boolean {
        this.data_.health -= damage;
        this.data_.flashTimer = 0.1;
        return this.data_.health <= 0;
    }

    applySlow(slowFactor: number, duration: number) {
        this.data_.slowTimer = duration;
        this.data_.slowFactor = Math.min(this.data_.slowFactor, slowFactor);
    }

    applyDOT(damage: number, duration: number) {
        this.data_.dotTimer = duration;
        this.data_.dotDamage = damage;
    }

    reachedEnd(): boolean {
        return this.data_.pathIndex >= this.worldPath.length - 1;
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
