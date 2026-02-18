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

    // Animation properties for level 4+
    hasAnimation: boolean = false;
    animationPhase: number = 0;
    private animatedParts: Graphics;

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
        this.addChild(this.base);

        // Animated parts layer (for level 4+ spinning elements)
        this.animatedParts = new Graphics();
        this.addChild(this.animatedParts);

        // Barrel (rotates)
        this.barrel = new Graphics();
        this.addChild(this.barrel);

        // Level text (hidden - we use visual evolution instead)
        this.levelText = new Text({
            text: '',
            style: { fontFamily: 'monospace', fontSize: 10, fill: '#ffffff' }
        });
        this.levelText.anchor.set(0.5, 0);
        this.levelText.position.set(0, CELL_SIZE * 0.35 + 4);
        this.levelText.visible = false; // Hide level text, use visual evolution instead
        this.addChild(this.levelText);

        // Draw initial appearance
        this.drawFullTurret();
        this.updateRangeCircle();
        this.updateSelectionRing();
    }

    update(dt: number) {
        // Accumulate time for frame-rate independent firing
        // This ensures guns fire reliably even during lag spikes
        this.fireAccumulator += dt;

        // Rotate barrel
        this.barrel.rotation = this.data_.angle;

        // Animate level 4+ turrets
        if (this.hasAnimation) {
            this.animationPhase += dt * 2;
            this.drawAnimatedParts();
        }
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
        // Full redraw after upgrade
        this.drawFullTurret();
        this.updateRangeCircle();
    }

    getSellValue(): number {
        // 25% refund of total investment (base cost + all upgrades)
        return Math.floor(this.data_.totalInvestment * 0.25);
    }

    /**
     * Draw the complete turret based on current level
     */
    private drawFullTurret() {
        const def = EMITTER_DEFS[this.data_.type];
        const level = this.data_.level;
        const color = def.color;

        // Clear graphics
        this.base.clear();
        this.barrel.clear();
        this.animatedParts.clear();

        // Draw type-specific turret
        switch (this.data_.type) {
            case 'water':
                this.drawWaterTurret(color, level);
                break;
            case 'fire':
                this.drawFireTurret(color, level);
                break;
            case 'electric':
                this.drawElectricTurret(color, level);
                break;
            case 'goo':
                this.drawGooTurret(color, level);
                break;
        }

        // Set animation flag for level 4+
        this.hasAnimation = level >= 4;
    }

    // ========== Water Turret Evolution ==========
    private drawWaterTurret(color: number, level: number) {
        const size = CELL_SIZE * 0.35;
        const dark = this.darkenColor(color);
        const light = this.lightenColor(color);

        // Base: circular water tank
        this.base.circle(0, 0, size).fill(color);
        this.base.circle(-size * 0.3, -size * 0.3, size * 0.3).fill({ color: light, alpha: 0.3 });

        // Level 1+: Side water tanks
        if (level >= 1) {
            this.base.roundRect(-size * 1.3, -size * 0.5, size * 0.5, size * 1.0, 3).fill(dark);
            this.base.roundRect(size * 0.8, -size * 0.5, size * 0.5, size * 1.0, 3).fill(dark);
            // Pipe connections
            this.base.rect(-size * 0.8, -size * 0.15, size * 0.3, size * 0.3).fill(color);
            this.base.rect(size * 0.5, -size * 0.15, size * 0.3, size * 0.3).fill(color);
        }

        // Level 2+: Pressure gauge on top
        if (level >= 2) {
            this.base.circle(0, -size * 0.6, size * 0.25).fill(0x222233);
            this.base.circle(0, -size * 0.6, size * 0.18).fill(0x88aacc);
            // Gauge needle
            this.base.moveTo(0, -size * 0.6);
            this.base.lineTo(size * 0.1, -size * 0.75);
            this.base.stroke({ color: 0xff4444, width: 2 });
        }

        // Level 3+: Glow ring
        if (level >= 3) {
            const glowSize = size * 1.4;
            this.base.circle(0, 0, glowSize).fill({ color: light, alpha: 0.15 });
            this.base.circle(0, 0, glowSize * 0.9).stroke({ color: light, width: 2, alpha: 0.3 });
        }

        // Barrel: Triple nozzle array
        const barrelLen = size * (level >= 2 ? 1.2 : 0.9);
        if (level >= 2) {
            // Triple barrel
            this.barrel.rect(0, -5, barrelLen, 3).fill(dark);
            this.barrel.rect(0, -1, barrelLen, 3).fill(dark);
            this.barrel.rect(0, 3, barrelLen, 3).fill(dark);
            // Nozzle tips
            this.barrel.circle(barrelLen, -3.5, 2).fill(light);
            this.barrel.circle(barrelLen, 0.5, 2).fill(light);
            this.barrel.circle(barrelLen, 4.5, 2).fill(light);
        } else {
            // Single barrel
            this.barrel.rect(0, -4, barrelLen, 8).fill(dark);
            this.barrel.circle(barrelLen, 0, 3).fill(light);
        }
    }

    // ========== Fire Turret Evolution ==========
    private drawFireTurret(color: number, level: number) {
        const size = CELL_SIZE * 0.35;
        const dark = this.darkenColor(color);
        const light = this.lightenColor(color);
        const emberColor = 0xffaa00;

        // Base: Furnace shape
        this.base.roundRect(-size, -size, size * 2, size * 2, 4).fill(dark);
        this.base.roundRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6, 3).fill(color);

        // Fire core
        this.base.circle(0, 0, size * 0.5).fill(emberColor);
        this.base.circle(0, 0, size * 0.3).fill(0xffdd44);

        // Level 1+: Side vents
        if (level >= 1) {
            // Vent slits
            for (let i = -1; i <= 1; i++) {
                this.base.rect(-size * 1.2, i * size * 0.4 - 2, size * 0.3, 4).fill(0x222222);
                this.base.rect(-size * 1.15, i * size * 0.4 - 1, size * 0.2, 2).fill(emberColor);
                this.base.rect(size * 0.9, i * size * 0.4 - 2, size * 0.3, 4).fill(0x222222);
                this.base.rect(size * 0.95, i * size * 0.4 - 1, size * 0.2, 2).fill(emberColor);
            }
        }

        // Level 2+: Heat shimmer indicators
        if (level >= 2) {
            // Heat waves above
            for (let i = 0; i < 3; i++) {
                const wave = new Graphics();
                const offset = (i - 1) * size * 0.4;
                this.base.moveTo(offset - size * 0.2, -size * 1.1 - i * 3);
                this.base.quadraticCurveTo(offset, -size * 1.3 - i * 3, offset + size * 0.2, -size * 1.1 - i * 3);
                this.base.stroke({ color: emberColor, width: 2, alpha: 0.3 + i * 0.1 });
            }
        }

        // Level 3+: Fire ring glow
        if (level >= 3) {
            this.base.circle(0, 0, size * 1.3).fill({ color: emberColor, alpha: 0.15 });
            this.base.circle(0, 0, size * 1.2).stroke({ color: color, width: 2, alpha: 0.4 });
        }

        // Barrel: Flame thrower nozzle
        const barrelLen = size * (level >= 2 ? 1.0 : 0.7);
        this.barrel.roundRect(0, -6, barrelLen * 0.7, 12, 2).fill(dark);
        this.barrel.roundRect(barrelLen * 0.5, -8, barrelLen * 0.5, 16, 2).fill(color);
        // Flame tip
        this.barrel.circle(barrelLen * 0.9, 0, 5).fill({ color: emberColor, alpha: 0.8 });
    }

    // ========== Electric Turret Evolution ==========
    private drawElectricTurret(color: number, level: number) {
        const size = CELL_SIZE * 0.35;
        const dark = this.darkenColor(color);
        const light = this.lightenColor(color);
        const arcColor = 0xaaddff;

        // Base: Tesla coil base
        this.base.roundRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6, 6).fill(0x333344);
        this.base.circle(0, 0, size * 0.6).fill(color);
        this.base.circle(0, 0, size * 0.4).fill(dark);
        this.base.circle(0, 0, size * 0.2).fill(light);

        // Level 1+: Tesla coil arms
        if (level >= 1) {
            // Side coils
            this.base.circle(-size * 1.0, -size * 0.3, size * 0.35).fill(0x333344);
            this.base.circle(-size * 1.0, -size * 0.3, size * 0.25).fill(color);
            this.base.circle(size * 1.0, -size * 0.3, size * 0.35).fill(0x333344);
            this.base.circle(size * 1.0, -size * 0.3, size * 0.25).fill(color);
            // Connection wires
            this.base.rect(-size * 0.8, -size * 0.35, size * 0.4, size * 0.1).fill(dark);
            this.base.rect(size * 0.4, -size * 0.35, size * 0.4, size * 0.1).fill(dark);
        }

        // Level 2+: Lightning rod antenna
        if (level >= 2) {
            this.base.rect(-2, -size * 1.5, 4, size * 0.8).fill(0x666688);
            this.base.circle(0, -size * 1.5, 4).fill(light);
            // Energy rings
            this.base.circle(0, -size * 1.3, 6).stroke({ color: arcColor, width: 1, alpha: 0.5 });
        }

        // Level 3+: Arc glow between coils
        if (level >= 3) {
            // Glow effect
            this.base.circle(0, 0, size * 1.2).fill({ color: arcColor, alpha: 0.1 });
            // Arc lines (static representation)
            if (level >= 1) {
                this.base.moveTo(-size * 0.8, -size * 0.3);
                this.base.lineTo(-size * 0.3, -size * 0.1);
                this.base.stroke({ color: arcColor, width: 2, alpha: 0.5 });
                this.base.moveTo(size * 0.8, -size * 0.3);
                this.base.lineTo(size * 0.3, -size * 0.1);
                this.base.stroke({ color: arcColor, width: 2, alpha: 0.5 });
            }
        }

        // Barrel: Energy projector
        const barrelLen = size * 0.8;
        this.barrel.rect(0, -3, barrelLen, 6).fill(dark);
        this.barrel.circle(barrelLen, 0, 4).fill(color);
        this.barrel.circle(barrelLen, 0, 2).fill(0xffffff);
    }

    // ========== Goo Turret Evolution ==========
    private drawGooTurret(color: number, level: number) {
        const size = CELL_SIZE * 0.35;
        const dark = this.darkenColor(color);
        const light = this.lightenColor(color);

        // Base: Blob container
        this.base.roundRect(-size * 0.9, -size * 0.9, size * 1.8, size * 1.8, 8).fill(0x333344);

        // Goo blob in center
        this.base.circle(0, 0, size * 0.6).fill(color);
        this.base.ellipse(-size * 0.15, -size * 0.2, size * 0.2, size * 0.15).fill({ color: light, alpha: 0.4 });

        // Level 1+: Side storage tanks
        if (level >= 1) {
            // Left tank
            this.base.roundRect(-size * 1.4, -size * 0.6, size * 0.4, size * 1.2, 4).fill(0x333344);
            this.base.roundRect(-size * 1.35, -size * 0.5, size * 0.3, size * 1.0, 3).fill(dark);
            // Goo fill level
            this.base.roundRect(-size * 1.35, 0, size * 0.3, size * 0.4, 3).fill(color);

            // Right tank
            this.base.roundRect(size * 1.0, -size * 0.6, size * 0.4, size * 1.2, 4).fill(0x333344);
            this.base.roundRect(size * 1.05, -size * 0.5, size * 0.3, size * 1.0, 3).fill(dark);
            // Goo fill level
            this.base.roundRect(size * 1.05, 0, size * 0.3, size * 0.4, 3).fill(color);

            // Pipes
            this.base.rect(-size * 1.0, -size * 0.1, size * 0.3, size * 0.2).fill(dark);
            this.base.rect(size * 0.7, -size * 0.1, size * 0.3, size * 0.2).fill(dark);
        }

        // Level 2+: Dripping nozzle array
        if (level >= 2) {
            // Drip lines
            for (let i = -1; i <= 1; i++) {
                const dx = i * size * 0.4;
                this.base.circle(dx, size * 0.9, 3).fill(color);
                this.base.ellipse(dx, size * 1.1, 2, 4).fill({ color: color, alpha: 0.6 });
            }
        }

        // Level 3+: Toxic glow aura
        if (level >= 3) {
            this.base.circle(0, 0, size * 1.3).fill({ color: color, alpha: 0.12 });
            this.base.circle(0, 0, size * 1.2).stroke({ color: light, width: 2, alpha: 0.3 });
        }

        // Barrel: Goo dispenser
        const barrelLen = size * 0.8;
        this.barrel.roundRect(0, -5, barrelLen, 10, 3).fill(0x333344);
        this.barrel.roundRect(barrelLen * 0.3, -4, barrelLen * 0.6, 8, 2).fill(dark);
        // Nozzle with drip
        this.barrel.circle(barrelLen, 0, 4).fill(color);
    }

    /**
     * Draw animated parts for level 4+ turrets
     */
    private drawAnimatedParts() {
        this.animatedParts.clear();

        const size = CELL_SIZE * 0.35;
        const def = EMITTER_DEFS[this.data_.type];
        const color = def.color;
        const light = this.lightenColor(color);

        switch (this.data_.type) {
            case 'water': {
                // Spinning water turbine
                const turbineRadius = size * 0.8;
                const blades = 4;
                for (let i = 0; i < blades; i++) {
                    const angle = this.animationPhase + (Math.PI * 2 / blades) * i;
                    const x1 = Math.cos(angle) * turbineRadius * 0.3;
                    const y1 = Math.sin(angle) * turbineRadius * 0.3;
                    const x2 = Math.cos(angle) * turbineRadius;
                    const y2 = Math.sin(angle) * turbineRadius;
                    this.animatedParts.moveTo(x1, y1);
                    this.animatedParts.lineTo(x2, y2);
                    this.animatedParts.stroke({ color: light, width: 3, alpha: 0.6 });
                }
                // Center hub
                this.animatedParts.circle(0, 0, size * 0.25).fill({ color: 0xffffff, alpha: 0.3 });
                break;
            }
            case 'fire': {
                // Rotating flame jets
                const flames = 3;
                for (let i = 0; i < flames; i++) {
                    const angle = this.animationPhase * 1.5 + (Math.PI * 2 / flames) * i;
                    const dist = size * 1.0;
                    const x = Math.cos(angle) * dist;
                    const y = Math.sin(angle) * dist;
                    // Flame shape
                    const flameSize = 4 + Math.sin(this.animationPhase * 3 + i) * 2;
                    this.animatedParts.circle(x, y, flameSize).fill({ color: 0xff6600, alpha: 0.7 });
                    this.animatedParts.circle(x, y, flameSize * 0.6).fill({ color: 0xffaa00, alpha: 0.8 });
                }
                break;
            }
            case 'electric': {
                // Spinning capacitor rings
                const rings = 2;
                for (let i = 0; i < rings; i++) {
                    const baseAngle = this.animationPhase * (i % 2 === 0 ? 1 : -1);
                    const ringRadius = size * (0.9 + i * 0.3);
                    // Draw arc segments
                    for (let j = 0; j < 4; j++) {
                        const segAngle = baseAngle + (Math.PI / 2) * j;
                        const x1 = Math.cos(segAngle) * ringRadius;
                        const y1 = Math.sin(segAngle) * ringRadius;
                        const x2 = Math.cos(segAngle + 0.3) * ringRadius;
                        const y2 = Math.sin(segAngle + 0.3) * ringRadius;
                        this.animatedParts.moveTo(x1, y1);
                        this.animatedParts.lineTo(x2, y2);
                        this.animatedParts.stroke({ color: 0xaaddff, width: 2, alpha: 0.6 });
                    }
                }
                // Spark effect
                const sparkAngle = this.animationPhase * 3;
                const sparkX = Math.cos(sparkAngle) * size * 0.5;
                const sparkY = Math.sin(sparkAngle) * size * 0.5;
                this.animatedParts.circle(sparkX, sparkY, 3).fill({ color: 0xffffff, alpha: 0.8 });
                break;
            }
            case 'goo': {
                // Bubbling animation
                const bubbles = 5;
                for (let i = 0; i < bubbles; i++) {
                    const phase = this.animationPhase + i * 1.2;
                    const bubbleY = (Math.sin(phase) + 1) * size * 0.3;
                    const bubbleX = Math.cos(phase * 0.7 + i) * size * 0.4;
                    const bubbleSize = 2 + Math.sin(phase * 2) * 1;
                    this.animatedParts.circle(bubbleX, -bubbleY, bubbleSize)
                        .fill({ color: light, alpha: 0.5 + Math.sin(phase) * 0.2 });
                }
                // Rising bubble trail
                for (let i = 0; i < 3; i++) {
                    const trailPhase = (this.animationPhase + i * 0.5) % 2;
                    const ty = -trailPhase * size * 0.8;
                    const tx = Math.sin(this.animationPhase * 2 + i) * size * 0.2;
                    this.animatedParts.circle(tx, ty - size * 0.3, 2 - trailPhase * 0.5)
                        .fill({ color: color, alpha: 0.6 - trailPhase * 0.2 });
                }
                break;
            }
        }
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

    private darkenColor(color: number, factor: number = 0.7): number {
        const r = Math.floor(((color >> 16) & 255) * factor);
        const g = Math.floor(((color >> 8) & 255) * factor);
        const b = Math.floor((color & 255) * factor);
        return (r << 16) | (g << 8) | b;
    }

    private lightenColor(color: number, factor: number = 0.3): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }
}
