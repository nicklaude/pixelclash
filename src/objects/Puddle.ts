import { Container, Graphics } from 'pixi.js';
import { PuddleData } from '../types';

export class Puddle extends Container {
    data_: PuddleData;
    graphics: Graphics;
    bubbles: Graphics;

    constructor(
        x: number,
        y: number,
        id: number,
        radius: number,
        duration: number,
        slowFactor: number,
        color: number
    ) {
        super();
        this.position.set(x, y);

        this.data_ = {
            id,
            x,
            y,
            radius,
            duration,
            slowFactor,
            color,
        };

        this.graphics = new Graphics();
        this.bubbles = new Graphics();
        this.addChild(this.graphics, this.bubbles);

        this.draw();
    }

    draw() {
        const alpha = Math.min(1, this.data_.duration / 2);

        this.graphics.clear();
        this.graphics.circle(0, 0, this.data_.radius)
            .fill({ color: this.data_.color, alpha: alpha * 0.4 });
    }

    drawBubbles() {
        const alpha = Math.min(1, this.data_.duration / 2);

        this.bubbles.clear();
        for (let i = 0; i < 3; i++) {
            const bx = (Math.random() - 0.5) * this.data_.radius;
            const by = (Math.random() - 0.5) * this.data_.radius;
            this.bubbles.circle(bx, by, 2)
                .fill({ color: this.data_.color, alpha: alpha * 0.6 });
        }
    }

    update(dt: number): boolean {
        this.data_.duration -= dt;

        if (this.data_.duration <= 0) {
            return false;
        }

        this.draw();
        this.drawBubbles();

        return true;
    }

    expand(additionalDuration: number, maxDuration: number, radiusIncrease: number, maxRadius: number) {
        this.data_.duration = Math.min(this.data_.duration + additionalDuration, maxDuration);
        this.data_.radius = Math.min(this.data_.radius + radiusIncrease, maxRadius);
    }

    containsPoint(px: number, py: number): boolean {
        const dx = px - this.x;
        const dy = py - this.y;
        return dx * dx + dy * dy < this.data_.radius * this.data_.radius;
    }
}
