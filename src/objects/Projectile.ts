import Phaser from 'phaser';
import { ParticleData, ParticleType } from '../types';

export class Projectile extends Phaser.Physics.Arcade.Sprite {
    data_: ParticleData;
    trail: Phaser.GameObjects.Graphics;
    trailPoints: Array<{ x: number; y: number }> = [];
    color: number;
    particleRadius: number;

    constructor(
        scene: Phaser.Scene,
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
        radius: number,
        sourceEmitterId: number
    ) {
        super(scene, x, y, 'projectile');

        this.data_ = {
            id,
            damage,
            pierce,
            lifespan,
            type,
            knockbackForce,
            hitEnemies: new Set(),
            sourceEmitterId,
        };

        this.color = color;
        this.particleRadius = radius;

        // Set up physics
        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setCircle(radius);
        body.setOffset(-radius / 2, -radius / 2);
        body.setVelocity(vx, vy);
        body.setAllowGravity(false);
        body.setBounce(0);
        body.setMaxVelocity(1000);

        this.setVisible(false); // Custom rendering

        // Create trail graphics
        this.trail = scene.add.graphics();
        this.trail.setDepth(5);
    }

    updateProjectile(dt: number): boolean {
        this.data_.lifespan -= dt;

        if (this.data_.lifespan <= 0 || this.data_.pierce <= 0) {
            return false; // Dead
        }

        // Update trail
        this.trailPoints.push({ x: this.x, y: this.y });
        if (this.trailPoints.length > 8) {
            this.trailPoints.shift();
        }

        return true;
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

    drawTrail() {
        this.trail.clear();

        // Draw trail
        if (this.trailPoints.length > 1) {
            const alpha = Math.min(1, this.data_.lifespan * 2);

            for (let i = 1; i < this.trailPoints.length; i++) {
                const p1 = this.trailPoints[i - 1];
                const p2 = this.trailPoints[i];
                const segmentAlpha = (i / this.trailPoints.length) * alpha * 0.5;
                const lineWidth = this.particleRadius * (i / this.trailPoints.length);

                this.trail.lineStyle(lineWidth, this.color, segmentAlpha);
                this.trail.beginPath();
                this.trail.moveTo(p1.x, p1.y);
                this.trail.lineTo(p2.x, p2.y);
                this.trail.strokePath();
            }
        }

        // Draw main particle
        const alpha = Math.min(1, this.data_.lifespan * 2);
        this.trail.fillStyle(this.color, alpha);
        this.trail.fillCircle(this.x, this.y, this.particleRadius);

        // Glow effect for electric
        if (this.data_.type === 'electric') {
            this.trail.fillStyle(0xffffaa, alpha * 0.3);
            this.trail.fillCircle(this.x, this.y, this.particleRadius * 2);
        }
    }

    cleanup() {
        this.trail.destroy();
    }
}
