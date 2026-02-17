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

        this.data_ = {
            id,
            type,
            gridX,
            gridY,
            level: 0,
            cooldown: 0,
            angle: 0,
            targetId: null,
        };

        const def = EMITTER_DEFS[type];
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
        this.data_.cooldown = Math.max(0, this.data_.cooldown - dt);

        // Update level text
        if (this.data_.level > 0) {
            this.levelText.text = `+${this.data_.level}`;
        }

        // Rotate barrel
        this.barrel.rotation = this.data_.angle;
    }

    canFire(): boolean {
        return this.data_.cooldown <= 0;
    }

    fire() {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        this.data_.cooldown = 1 / (def.fireRate * mult.fireRate);
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

    getSellValue(): number {
        const def = EMITTER_DEFS[this.data_.type];
        return Math.floor(def.cost * 0.6 * (1 + this.data_.level * 0.3));
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
