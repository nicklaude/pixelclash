import Phaser from 'phaser';
import { PuddleData } from '../types';

export class Puddle extends Phaser.GameObjects.Container {
    data_: PuddleData;
    circle: Phaser.GameObjects.Arc;
    bubbles: Phaser.GameObjects.Graphics;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        id: number,
        radius: number,
        duration: number,
        slowFactor: number,
        color: number
    ) {
        super(scene, x, y);

        this.data_ = {
            id,
            x,
            y,
            radius,
            duration,
            slowFactor,
            color,
        };

        // Main puddle
        this.circle = scene.add.arc(0, 0, radius, 0, 360, false, color, 0.4);
        this.add(this.circle);

        // Bubbles graphics
        this.bubbles = scene.add.graphics();
        this.add(this.bubbles);

        scene.add.existing(this);
        this.setDepth(1);
    }

    updatePuddle(dt: number): boolean {
        this.data_.duration -= dt;

        if (this.data_.duration <= 0) {
            return false; // Expired
        }

        // Update alpha based on remaining duration
        const alpha = Math.min(1, this.data_.duration / 2);
        this.circle.setFillStyle(this.data_.color, alpha * 0.4);

        // Update bubbles
        this.bubbles.clear();
        for (let i = 0; i < 3; i++) {
            const bx = (Math.random() - 0.5) * this.data_.radius;
            const by = (Math.random() - 0.5) * this.data_.radius;
            this.bubbles.fillStyle(this.data_.color, alpha * 0.6);
            this.bubbles.fillCircle(bx, by, 2);
        }

        return true;
    }

    expand(additionalDuration: number, maxDuration: number, radiusIncrease: number, maxRadius: number) {
        this.data_.duration = Math.min(this.data_.duration + additionalDuration, maxDuration);
        this.data_.radius = Math.min(this.data_.radius + radiusIncrease, maxRadius);
        this.circle.setRadius(this.data_.radius);
    }

    containsPoint(px: number, py: number): boolean {
        const dx = px - this.data_.x;
        const dy = py - this.data_.y;
        return dx * dx + dy * dy < this.data_.radius * this.data_.radius;
    }
}
