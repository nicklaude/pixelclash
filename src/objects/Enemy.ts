import Phaser from 'phaser';
import { EnemyData, EnemyType, Vec2 } from '../types';
import { ENEMY_DEFS, CELL_SIZE, KNOCKBACK_VELOCITY_THRESHOLD } from '../config';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
    data_: EnemyData;
    worldPath: Vec2[];
    healthBar: Phaser.GameObjects.Graphics;
    dotParticles: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        id: number,
        type: EnemyType,
        worldPath: Vec2[],
        waveNum: number,
        scale: number = 1
    ) {
        super(scene, x, y, 'enemy');

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

        this.worldPath = worldPath;

        // If spawning mid-path (splitter child), find nearest path index
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

        // Set up physics body
        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setCircle(def.size);
        body.setOffset(-def.size / 2, -def.size / 2);
        body.setDrag(0);
        body.setBounce(0.2);
        body.setMaxVelocity(600);

        // Create the visual representation
        this.setVisible(false); // We'll draw custom graphics instead

        // Create health bar
        this.healthBar = scene.add.graphics();
        this.updateHealthBar();
    }

    updateEnemy(dt: number): boolean {
        const def = ENEMY_DEFS[this.data_.type];
        const body = this.body as Phaser.Physics.Arcade.Body;

        // Flash timer
        if (this.data_.flashTimer > 0) {
            this.data_.flashTimer -= dt;
        }

        // DOT damage
        if (this.data_.dotTimer > 0) {
            this.data_.dotTimer -= dt;
            this.data_.health -= this.data_.dotDamage * dt;
            if (this.data_.health <= 0) {
                return false; // Dead
            }
        }

        // Apply friction to knockback velocity
        const currentVelX = body.velocity.x;
        const currentVelY = body.velocity.y;
        const speed = Math.sqrt(currentVelX * currentVelX + currentVelY * currentVelY);

        // Apply friction - reduce velocity over time
        const frictionFactor = Math.pow(this.data_.friction, dt * 60);
        body.setVelocity(
            currentVelX * frictionFactor,
            currentVelY * frictionFactor
        );

        // Clear very small velocities
        if (Math.abs(body.velocity.x) < 1) body.velocity.x = 0;
        if (Math.abs(body.velocity.y) < 1) body.velocity.y = 0;

        // Path following (when not being knocked back significantly)
        const knockbackSpeed = Math.sqrt(
            body.velocity.x * body.velocity.x +
            body.velocity.y * body.velocity.y
        );

        if (knockbackSpeed < KNOCKBACK_VELOCITY_THRESHOLD) {
            // Move toward next waypoint
            const currentTarget = this.worldPath[this.data_.pathIndex + 1];
            if (!currentTarget) {
                // Reached the nexus
                return false; // Signal to damage player
            }

            const speedMult = this.data_.slowTimer > 0 ? this.data_.slowFactor : 1;
            this.data_.slowTimer = Math.max(0, this.data_.slowTimer - dt);

            const dx = currentTarget.x - this.x;
            const dy = currentTarget.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const moveSpeed = this.data_.baseSpeed * speedMult;

            if (dist < 2) {
                // Reached waypoint
                this.setPosition(currentTarget.x, currentTarget.y);
                this.data_.pathIndex++;
            } else {
                // Move towards waypoint
                const nx = dx / dist;
                const ny = dy / dist;
                this.setPosition(
                    this.x + nx * moveSpeed * dt,
                    this.y + ny * moveSpeed * dt
                );
            }
        }

        // Reset slow factor each frame (puddles reapply it)
        this.data_.slowFactor = 1;

        this.updateHealthBar();
        return true; // Still alive
    }

    applyKnockback(forceX: number, forceY: number) {
        const body = this.body as Phaser.Physics.Arcade.Body;
        const knockbackMult = 1 / this.data_.mass;
        body.velocity.x += forceX * knockbackMult;
        body.velocity.y += forceY * knockbackMult;
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

    updateHealthBar() {
        const def = ENEMY_DEFS[this.data_.type];
        const barWidth = def.size * 2;
        const barHeight = 4;
        const barY = -def.size - 8;
        const healthPct = this.data_.health / this.data_.maxHealth;

        this.healthBar.clear();

        // Background
        this.healthBar.fillStyle(0x333333, 1);
        this.healthBar.fillRect(this.x - barWidth/2, this.y + barY, barWidth, barHeight);

        // Health
        let healthColor = 0x44ff44;
        if (healthPct < 0.5) healthColor = 0xffcc00;
        if (healthPct < 0.25) healthColor = 0xff4444;
        this.healthBar.fillStyle(healthColor, 1);
        this.healthBar.fillRect(this.x - barWidth/2, this.y + barY, barWidth * healthPct, barHeight);

        // Border
        this.healthBar.lineStyle(1, 0x000000, 1);
        this.healthBar.strokeRect(this.x - barWidth/2, this.y + barY, barWidth, barHeight);
    }

    reachedEnd(): boolean {
        return this.data_.pathIndex >= this.worldPath.length - 1;
    }

    cleanup() {
        this.healthBar.destroy();
        if (this.dotParticles) {
            this.dotParticles.stop();
        }
    }
}
