import Phaser from 'phaser';
import { EmitterData, EmitterType, Vec2 } from '../types';
import { EMITTER_DEFS, CELL_SIZE, getUpgradeMultiplier } from '../config';

export class Emitter extends Phaser.GameObjects.Container {
    data_: EmitterData;
    base: Phaser.GameObjects.Rectangle;
    barrel: Phaser.GameObjects.Rectangle;
    nozzle: Phaser.GameObjects.Rectangle;
    levelText: Phaser.GameObjects.Text;
    rangeCircle: Phaser.GameObjects.Arc;
    selectionRing: Phaser.GameObjects.Arc;

    constructor(
        scene: Phaser.Scene,
        gridX: number,
        gridY: number,
        id: number,
        type: EmitterType
    ) {
        const pixelX = gridX * CELL_SIZE + CELL_SIZE / 2;
        const pixelY = gridY * CELL_SIZE + CELL_SIZE / 2;

        super(scene, pixelX, pixelY);

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

        // Base
        this.base = scene.add.rectangle(0, 0, size, size, def.color);
        this.add(this.base);

        // Barrel (rotates)
        this.barrel = scene.add.rectangle(size * 0.3, 0, size * 0.6, 8, this.darkenColor(def.color));
        this.barrel.setOrigin(0, 0.5);
        this.add(this.barrel);

        // Nozzle
        this.nozzle = scene.add.rectangle(size * 0.5, 0, 6, 6, 0x333333);
        this.add(this.nozzle);

        // Level indicator
        this.levelText = scene.add.text(0, size / 2 + 8, '', {
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#ffffff',
        });
        this.levelText.setOrigin(0.5, 0);
        this.add(this.levelText);

        // Range circle (hidden by default)
        const range = def.range * CELL_SIZE;
        this.rangeCircle = scene.add.arc(0, 0, range, 0, 360, false, 0x4488ff, 0.1);
        this.rangeCircle.setStrokeStyle(2, 0x4488ff, 0.5);
        this.rangeCircle.setVisible(false);
        this.add(this.rangeCircle);

        // Selection ring (hidden by default)
        this.selectionRing = scene.add.arc(0, 0, size * 0.7, 0, 360, false, 0xffffff, 0);
        this.selectionRing.setStrokeStyle(2, 0xffffff, 1);
        this.selectionRing.setVisible(false);
        this.add(this.selectionRing);

        scene.add.existing(this);
        this.setDepth(10);
    }

    updateEmitter(dt: number) {
        this.data_.cooldown = Math.max(0, this.data_.cooldown - dt);

        // Update level text
        if (this.data_.level > 0) {
            this.levelText.setText(`+${this.data_.level}`);
        }

        // Rotate barrel
        this.barrel.setRotation(this.data_.angle);
        this.nozzle.setPosition(
            Math.cos(this.data_.angle) * CELL_SIZE * 0.5,
            Math.sin(this.data_.angle) * CELL_SIZE * 0.5
        );
    }

    canFire(): boolean {
        return this.data_.cooldown <= 0;
    }

    fire() {
        const def = EMITTER_DEFS[this.data_.type];
        const mult = getUpgradeMultiplier(this.data_.level);
        this.data_.cooldown = 1 / (def.fireRate * mult.fireRate);
    }

    setSelected(selected: boolean) {
        this.selectionRing.setVisible(selected);
        this.rangeCircle.setVisible(selected);
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

    getPosition(): Vec2 {
        return { x: this.x, y: this.y };
    }

    upgrade() {
        this.data_.level++;

        // Update range circle
        const range = this.getRange();
        this.rangeCircle.setRadius(range);
    }

    getSellValue(): number {
        const def = EMITTER_DEFS[this.data_.type];
        return Math.floor(def.cost * 0.6 * (1 + this.data_.level * 0.3));
    }

    private darkenColor(color: number): number {
        const r = Math.floor(((color >> 16) & 255) * 0.7);
        const g = Math.floor(((color >> 8) & 255) * 0.7);
        const b = Math.floor((color & 255) * 0.7);
        return (r << 16) | (g << 8) | b;
    }
}
