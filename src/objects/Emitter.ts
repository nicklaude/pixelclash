import { Container, Graphics, Text } from 'pixi.js';
import { EmitterData, EmitterType, Vec2 } from '../types';
import { EMITTER_DEFS, CELL_SIZE, getUpgradeMultiplier, UI_TOP_HEIGHT } from '../config';

export class Emitter extends Container {
    data_: EmitterData;
    base: Graphics;
    barrel: Graphics;
    rangeCircle: Graphics;
    selectionRing: Graphics;
    levelText: Text;

    // Accumulator for frame-rate independent firing
    // This ensures guns fire reliably even during lag spikes
    private fireAccumulator: number = 0;

    constructor(
        gridX: number,
        gridY: number,
        id: number,
        type: EmitterType
    ) {
        super();

        const pixelX = gridX * CELL_SIZE + CELL_SIZE / 2;
        const pixelY = gridY * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT;
        this.position.set(pixelX, pixelY);

        const def = EMITTER_DEFS[type];
        this.data_ = {
            id,
            type,
            gridX,
            gridY,
            level: 0,
            cooldown: 0,
            angle: 0,
            targetId: null,
            totalInvestment: def.cost,  // Initialize with base cost
        };

        const size = CELL_SIZE * 0.7;

        // Range circle (behind everything)
        this.rangeCircle = new Graphics();
        this.rangeCircle.visible = false;
        this.addChild(this.rangeCircle);

        // Selection ring
        this.selectionRing = new Graphics();
        this.selectionRing.visible = false;
        this.addChild(this.selectionRing);

        // Base
        this.base = new Graphics();
        this.base.rect(-size / 2, -size / 2, size, size).fill(def.color);
        this.addChild(this.base);

        // Barrel (rotates)
        this.barrel = new Graphics();
        this.barrel.rect(0, -4, size * 0.6, 8).fill(this.darkenColor(def.color));
        this.addChild(this.barrel);

        // Level text
        this.levelText = new Text({
            text: '',
            style: { fontFamily: 'monospace', fontSize: 10, fill: '#ffffff' }
        });
        this.levelText.anchor.set(0.5, 0);
        this.levelText.position.set(0, size / 2 + 4);
        this.addChild(this.levelText);

        this.updateRangeCircle();
        this.updateSelectionRing();
    }

    update(dt: number) {
        // Accumulate time for frame-rate independent firing
        // This ensures guns fire reliably even during lag spikes
        this.fireAccumulator += dt;

        // Update level text
        if (this.data_.level > 0) {
            this.levelText.text = `+${this.data_.level}`;
        }

        // Rotate barrel
        this.barrel.rotation = this.data_.angle;
    }

    /**
     * Check if emitter can fire and how many shots should be fired.
     * Returns the number of shots to fire this frame (usually 0 or 1, but
     * can be more during lag spikes to catch up).
     */
    getFireCount(): number {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        const fireInterval = 1 / (def.fireRate * mult.fireRate);

        // Calculate how many shots should have fired based on accumulated time
        const shotCount = Math.floor(this.fireAccumulator / fireInterval);
        return shotCount;
    }

    canFire(): boolean {
        return this.getFireCount() > 0;
    }

    /**
     * Fire the emitter - consumes one shot from the accumulator
     */
    fire() {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        const fireInterval = 1 / (def.fireRate * mult.fireRate);

        // Consume one fire interval from accumulator
        this.fireAccumulator -= fireInterval;

        // Clamp accumulator to prevent runaway catching up
        // Allow at most 3 shots worth of accumulation
        const maxAccumulation = fireInterval * 3;
        if (this.fireAccumulator > maxAccumulation) {
            this.fireAccumulator = maxAccumulation;
        }
    }

    /**
     * Reset the fire accumulator (e.g., when emitter loses target)
     */
    resetFireAccumulator() {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        const fireInterval = 1 / (def.fireRate * mult.fireRate);
        // Keep partial accumulation but cap it
        this.fireAccumulator = Math.min(this.fireAccumulator, fireInterval * 0.5);
    }

    aimAt(targetX: number, targetY: number) {
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        this.data_.angle = Math.atan2(dy, dx);
    }

    getRange(): number {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        return def.range * mult.range * CELL_SIZE;
    }

    setSelected(selected: boolean) {
        this.rangeCircle.visible = selected;
        this.selectionRing.visible = selected;
    }

    upgrade() {
        this.data_.level++;
        this.updateRangeCircle();
    }

    redraw() {
        // Update range circle after upgrade
        this.updateRangeCircle();
        // Update level text immediately
        if (this.data_.level > 0) {
            this.levelText.text = `+${this.data_.level}`;
        }
    }

    getSellValue(): number {
        // 25% refund of total investment (base cost + all upgrades)
        return Math.floor(this.data_.totalInvestment * 0.25);
    }

    private updateRangeCircle() {
        const range = this.getRange();
        this.rangeCircle.clear();
        this.rangeCircle.circle(0, 0, range)
            .fill({ color: 0x4488ff, alpha: 0.1 })
            .stroke({ color: 0x4488ff, width: 2, alpha: 0.5 });
    }

    private updateSelectionRing() {
        const size = CELL_SIZE * 0.7 * 0.7;
        this.selectionRing.clear();
        this.selectionRing.circle(0, 0, size)
            .stroke({ color: 0xffffff, width: 2 });
    }

    private darkenColor(color: number): number {
        const r = Math.floor(((color >> 16) & 255) * 0.7);
        const g = Math.floor(((color >> 8) & 255) * 0.7);
        const b = Math.floor((color & 255) * 0.7);
        return (r << 16) | (g << 8) | b;
    }
}
