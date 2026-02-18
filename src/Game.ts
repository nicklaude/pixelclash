import { Application, Container, Graphics, Text, FederatedPointerEvent, TextStyle, Rectangle } from 'pixi.js';
import {
    GRID_SIZE, CELL_SIZE, GAME_WIDTH, GAME_HEIGHT, UI_TOP_HEIGHT, UI_BOTTOM_HEIGHT,
    PATH, NEXUS_X, NEXUS_Y, getPathCells,
    EMITTER_DEFS, ENEMY_DEFS, getUpgradeMultiplier,
    STARTING_GOLD, STARTING_HEALTH, generateWave, getUpgradeCost,
    MAX_PARTICLES, AUTO_WAVE_DELAY, CANVAS_WIDTH, CANVAS_HEIGHT
} from './config';
import { GameState, EmitterType, EnemyType, Vec2, ParticleType } from './types';
import { Enemy } from './objects/Enemy';
import { Emitter } from './objects/Emitter';
import { Projectile } from './objects/Projectile';
import { Puddle } from './objects/Puddle';

export class Game {
    app: Application;

    // Layers
    gridLayer: Container;
    puddleLayer: Container;
    emitterLayer: Container;
    enemyLayer: Container;
    projectileLayer: Container;
    effectLayer: Container;
    uiLayer: Container;

    // Game objects
    enemies: Enemy[] = [];
    emitters: Emitter[] = [];
    projectiles: Projectile[] = [];
    puddles: Puddle[] = [];

    // Path data
    pathCells: Set<string>;
    occupiedCells: Set<string> = new Set();
    worldPath: Vec2[];

    // State
    state: GameState;

    // Graphics
    gridGraphics: Graphics;
    nexusGraphics: Graphics;
    hoverGraphics: Graphics;
    chainGraphics: Graphics;

    // UI Elements
    goldText!: Text;
    healthText!: Text;
    waveText!: Text;
    pauseText!: Text;
    towerButtons: Container[] = [];
    selectedPanel: Container | null = null;

    // Hover/Selection
    hoverCell: { x: number; y: number } | null = null;

    // Effects
    chainEffects: Array<{ from: Vec2; to: Vec2; timer: number }> = [];
    deathParticles: Array<{
        x: number; y: number;
        vx: number; vy: number;
        color: number;
        size: number;
        life: number;
    }> = [];
    nexusPulse: number = 0;

    // Auto-wave
    autoWaveTimer: number = AUTO_WAVE_DELAY;
    autoWaveEnabled: boolean = true;

    // Screen shake
    shakeIntensity: number = 0;
    shakeDuration: number = 0;

    // Game container (for shake offset)
    gameContainer: Container;

    // Background effects
    backgroundStars: Array<{ x: number; y: number; size: number; twinkle: number; speed: number }> = [];
    backgroundGraphics: Graphics;
    ambientTime: number = 0;

    constructor(app: Application) {
        this.app = app;

        // Initialize state
        this.state = {
            gold: STARTING_GOLD,
            health: STARTING_HEALTH,
            wave: 0,
            waveActive: false,
            selectedEmitterType: null,
            selectedEmitterId: null,
            nextId: 1,
            spawnQueue: [],
            gameOver: false,
            paused: false,
        };

        // Initialize path
        this.pathCells = getPathCells();
        this.worldPath = PATH.map(p => this.gridToPixel(p.x, p.y));

        // Create game container (for screen shake)
        this.gameContainer = new Container();
        app.stage.addChild(this.gameContainer);

        // Create layers in order
        this.gridLayer = new Container();
        this.puddleLayer = new Container();
        this.emitterLayer = new Container();
        this.enemyLayer = new Container();
        this.projectileLayer = new Container();
        this.effectLayer = new Container();
        this.uiLayer = new Container();

        this.gameContainer.addChild(
            this.gridLayer,
            this.puddleLayer,
            this.emitterLayer,
            this.enemyLayer,
            this.projectileLayer,
            this.effectLayer
        );
        app.stage.addChild(this.uiLayer);

        // Create background graphics (below grid)
        this.backgroundGraphics = new Graphics();
        this.gridLayer.addChild(this.backgroundGraphics);

        // Create graphics objects
        this.gridGraphics = new Graphics();
        this.gridLayer.addChild(this.gridGraphics);

        // Initialize background stars
        this.initBackgroundEffects();

        this.nexusGraphics = new Graphics();
        this.gridLayer.addChild(this.nexusGraphics);

        this.hoverGraphics = new Graphics();
        this.effectLayer.addChild(this.hoverGraphics);

        this.chainGraphics = new Graphics();
        this.effectLayer.addChild(this.chainGraphics);

        // Draw static grid
        this.drawGrid();

        // Create UI
        this.createUI();

        // Set up input
        this.setupInput();
    }

    // ========== Background Effects ==========

    initBackgroundEffects() {
        // Create floating particles/stars for ambient effect
        for (let i = 0; i < 60; i++) {
            this.backgroundStars.push({
                x: Math.random() * GAME_WIDTH,
                y: Math.random() * GAME_HEIGHT + UI_TOP_HEIGHT,
                size: 1 + Math.random() * 2,
                twinkle: Math.random() * Math.PI * 2,
                speed: 0.5 + Math.random() * 1.5,
            });
        }
    }

    drawBackground() {
        const g = this.backgroundGraphics;
        g.clear();

        this.ambientTime += 0.02;

        // Draw twinkling stars/motes
        for (const star of this.backgroundStars) {
            star.twinkle += star.speed * 0.05;
            const alpha = 0.2 + Math.sin(star.twinkle) * 0.3;
            const pulse = 1 + Math.sin(star.twinkle * 2) * 0.3;

            // Soft glow
            g.circle(star.x, star.y, star.size * pulse * 1.5)
                .fill({ color: 0x4488ff, alpha: alpha * 0.3 });
            g.circle(star.x, star.y, star.size * pulse)
                .fill({ color: 0xaaccff, alpha: alpha });
        }

        // Animated path glow - energy flowing along the path
        const glowPoints = 8;
        for (let i = 0; i < glowPoints; i++) {
            const progress = ((this.ambientTime * 0.3 + i / glowPoints) % 1);
            const pathIndex = Math.floor(progress * (this.worldPath.length - 1));
            const nextIndex = Math.min(pathIndex + 1, this.worldPath.length - 1);
            const t = (progress * (this.worldPath.length - 1)) % 1;

            const x = this.worldPath[pathIndex].x + (this.worldPath[nextIndex].x - this.worldPath[pathIndex].x) * t;
            const y = this.worldPath[pathIndex].y + (this.worldPath[nextIndex].y - this.worldPath[pathIndex].y) * t;

            const fadeIn = Math.min(1, progress * 5);
            const fadeOut = 1 - Math.max(0, (progress - 0.8) * 5);
            const alpha = fadeIn * fadeOut * 0.4;

            g.circle(x, y, 8 + Math.sin(this.ambientTime * 3 + i) * 2)
                .fill({ color: 0xff6644, alpha: alpha * 0.3 });
            g.circle(x, y, 4)
                .fill({ color: 0xffaa88, alpha: alpha });
        }

        // Corner vignette effect (dark edges)
        const vignetteGrad = [
            { x: 0, y: UI_TOP_HEIGHT, alpha: 0.3 },
            { x: GAME_WIDTH, y: UI_TOP_HEIGHT, alpha: 0.3 },
            { x: 0, y: GAME_HEIGHT + UI_TOP_HEIGHT, alpha: 0.3 },
            { x: GAME_WIDTH, y: GAME_HEIGHT + UI_TOP_HEIGHT, alpha: 0.3 },
        ];
        for (const v of vignetteGrad) {
            g.circle(v.x, v.y, CELL_SIZE * 3)
                .fill({ color: 0x000011, alpha: v.alpha });
        }
    }

    // ========== Grid Helpers ==========

    gridToPixel(gx: number, gy: number): Vec2 {
        return {
            x: gx * CELL_SIZE + CELL_SIZE / 2,
            y: gy * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT,
        };
    }

    pixelToGrid(px: number, py: number): { x: number; y: number } | null {
        const gx = Math.floor(px / CELL_SIZE);
        const gy = Math.floor((py - UI_TOP_HEIGHT) / CELL_SIZE);
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return null;
        return { x: gx, y: gy };
    }

    canPlaceEmitter(gx: number, gy: number): boolean {
        const key = `${gx},${gy}`;
        if (this.pathCells.has(key)) return false;
        if (this.occupiedCells.has(key)) return false;
        if (gx === NEXUS_X && gy === NEXUS_Y) return false;
        return true;
    }

    // ========== Drawing ==========

    drawGrid() {
        const g = this.gridGraphics;
        g.clear();

        // Deep space background gradient
        for (let y = 0; y < GRID_SIZE; y++) {
            const gradientAlpha = 0.1 + (y / GRID_SIZE) * 0.15;
            g.rect(0, y * CELL_SIZE + UI_TOP_HEIGHT, GAME_WIDTH, CELL_SIZE)
                .fill({ color: 0x0a0a1e, alpha: gradientAlpha });
        }

        // Draw path glow first (underneath tiles)
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const key = `${x},${y}`;
                if (this.pathCells.has(key)) {
                    // Soft underglow for path
                    g.rect(x * CELL_SIZE - 2, y * CELL_SIZE - 2 + UI_TOP_HEIGHT, CELL_SIZE + 4, CELL_SIZE + 4)
                        .fill({ color: 0xff4422, alpha: 0.1 });
                }
            }
        }

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const key = `${x},${y}`;
                const isPath = this.pathCells.has(key);
                const isNexus = x === NEXUS_X && y === NEXUS_Y;

                if (isNexus) continue;

                const px = x * CELL_SIZE;
                const py = y * CELL_SIZE + UI_TOP_HEIGHT;

                if (isPath) {
                    // Lava/molten path - dangerous looking
                    const baseColor = 0x2a1a0a;
                    g.rect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2)
                        .fill(baseColor);

                    // Cracks with lava glow
                    const crackSeed = (x * 17 + y * 31) % 7;
                    g.moveTo(px + 4, py + 4);
                    g.lineTo(px + CELL_SIZE / 2 + crackSeed, py + CELL_SIZE / 2);
                    g.lineTo(px + CELL_SIZE - 4, py + CELL_SIZE - 6);
                    g.stroke({ color: 0xff6633, alpha: 0.6, width: 2 });

                    // Additional crack
                    if (crackSeed > 3) {
                        g.moveTo(px + CELL_SIZE - 6, py + 5);
                        g.lineTo(px + CELL_SIZE / 2, py + CELL_SIZE - 5);
                        g.stroke({ color: 0xff4422, alpha: 0.4, width: 1 });
                    }

                    // Hot spots
                    g.circle(px + 8 + (crackSeed * 2), py + 12 + crackSeed, 3)
                        .fill({ color: 0xff8844, alpha: 0.5 });

                    // Edge highlight
                    g.rect(px + 1, py + 1, CELL_SIZE - 2, 2)
                        .fill({ color: 0x442211, alpha: 0.6 });
                } else {
                    // Crystal/alien terrain
                    const shade = ((x + y) % 2 === 0) ? 0x1a2a3a : 0x152535;
                    g.rect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2)
                        .fill(shade);

                    // Crystal formations
                    const crystalSeed = (x * 11 + y * 23) % 9;
                    if (crystalSeed < 2) {
                        // Small crystal cluster
                        const cx = px + 8 + (crystalSeed * 6);
                        const cy = py + 10 + (crystalSeed * 4);
                        g.moveTo(cx, cy + 8);
                        g.lineTo(cx - 3, cy + 3);
                        g.lineTo(cx, cy - 2);
                        g.lineTo(cx + 3, cy + 3);
                        g.closePath();
                        g.fill({ color: 0x44aacc, alpha: 0.4 });
                        g.stroke({ color: 0x66ccee, alpha: 0.3, width: 1 });
                    } else if (crystalSeed === 3) {
                        // Alien plant
                        g.circle(px + 20, py + 18, 4)
                            .fill({ color: 0x33ff88, alpha: 0.2 });
                        g.circle(px + 20, py + 18, 2)
                            .fill({ color: 0x88ffaa, alpha: 0.4 });
                    } else if (crystalSeed === 5) {
                        // Small rock
                        g.ellipse(px + 14, py + 20, 6, 4)
                            .fill({ color: 0x2a3a4a, alpha: 0.7 });
                    }

                    // Subtle grid texture
                    g.rect(px + 2, py + CELL_SIZE - 3, CELL_SIZE - 4, 1)
                        .fill({ color: 0x0a1a2a, alpha: 0.4 });
                }
            }
        }

        // Grid lines (subtle cyan glow)
        g.setStrokeStyle({ color: 0x224466, alpha: 0.15, width: 1 });
        for (let i = 0; i <= GRID_SIZE; i++) {
            g.moveTo(i * CELL_SIZE, UI_TOP_HEIGHT).lineTo(i * CELL_SIZE, UI_TOP_HEIGHT + GAME_HEIGHT).stroke();
            g.moveTo(0, i * CELL_SIZE + UI_TOP_HEIGHT).lineTo(GAME_WIDTH, i * CELL_SIZE + UI_TOP_HEIGHT).stroke();
        }
    }

    drawNexus() {
        const g = this.nexusGraphics;
        g.clear();

        const cx = NEXUS_X * CELL_SIZE + CELL_SIZE / 2;
        const cy = NEXUS_Y * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT;

        this.nexusPulse += 0.03;
        const pulse = 0.7 + Math.sin(this.nexusPulse) * 0.3;
        const fastPulse = 0.5 + Math.sin(this.nexusPulse * 3) * 0.5;

        // Outer expanding rings
        for (let i = 0; i < 3; i++) {
            const ringPulse = (this.nexusPulse * 0.5 + i * 0.33) % 1;
            const ringRadius = CELL_SIZE * 0.5 + ringPulse * CELL_SIZE * 0.8;
            const ringAlpha = (1 - ringPulse) * 0.2;
            g.circle(cx, cy, ringRadius)
                .stroke({ color: 0x4488ff, alpha: ringAlpha, width: 2 });
        }

        // Outer glow
        g.circle(cx, cy, CELL_SIZE * 0.9 * pulse)
            .fill({ color: 0x2244aa, alpha: pulse * 0.2 });

        // Mid glow
        g.circle(cx, cy, CELL_SIZE * 0.6 * pulse)
            .fill({ color: 0x3366cc, alpha: pulse * 0.4 });

        // Core crystal shape (hexagon)
        const coreSize = CELL_SIZE * 0.35;
        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
            points.push(cx + Math.cos(angle) * coreSize);
            points.push(cy + Math.sin(angle) * coreSize);
        }
        g.poly(points).fill(0x4488ff);
        g.poly(points).stroke({ color: 0x66aaff, width: 2 });

        // Inner core
        g.circle(cx, cy, CELL_SIZE * 0.15)
            .fill(0xaaccff);

        // Sparkle effects
        for (let i = 0; i < 4; i++) {
            const sparkAngle = this.nexusPulse * 2 + i * Math.PI / 2;
            const sparkDist = CELL_SIZE * 0.25 + fastPulse * 5;
            const sx = cx + Math.cos(sparkAngle) * sparkDist;
            const sy = cy + Math.sin(sparkAngle) * sparkDist;
            g.circle(sx, sy, 2 + fastPulse * 2)
                .fill({ color: 0xffffff, alpha: fastPulse * 0.8 });
        }

        // Health indicator ring
        const healthPct = this.state.health / STARTING_HEALTH;
        if (healthPct < 1) {
            const healthColor = healthPct > 0.5 ? 0x44ff44 : healthPct > 0.25 ? 0xffcc00 : 0xff4444;
            g.arc(cx, cy, CELL_SIZE * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * healthPct)
                .stroke({ color: healthColor, width: 3, alpha: 0.8 });
        }
    }

    drawHoverCell() {
        const g = this.hoverGraphics;
        g.clear();

        if (this.hoverCell && this.state.selectedEmitterType) {
            const valid = this.canPlaceEmitter(this.hoverCell.x, this.hoverCell.y);

            g.rect(
                this.hoverCell.x * CELL_SIZE,
                this.hoverCell.y * CELL_SIZE + UI_TOP_HEIGHT,
                CELL_SIZE,
                CELL_SIZE
            ).fill({ color: valid ? 0x00ff00 : 0xff0000, alpha: 0.3 });

            g.rect(
                this.hoverCell.x * CELL_SIZE + 1,
                this.hoverCell.y * CELL_SIZE + 1 + UI_TOP_HEIGHT,
                CELL_SIZE - 2,
                CELL_SIZE - 2
            ).stroke({ color: valid ? 0x00ff00 : 0xff0000, width: 2 });
        }
    }

    drawChainEffects() {
        const g = this.chainGraphics;
        g.clear();

        for (const effect of this.chainEffects) {
            const segments = 5;
            const jitter = 8;

            // Build jagged path
            const points: Vec2[] = [effect.from];
            for (let i = 1; i < segments; i++) {
                const t = i / segments;
                points.push({
                    x: effect.from.x + (effect.to.x - effect.from.x) * t + (Math.random() - 0.5) * jitter,
                    y: effect.from.y + (effect.to.y - effect.from.y) * t + (Math.random() - 0.5) * jitter,
                });
            }
            points.push(effect.to);

            // Outer glow
            g.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) {
                g.lineTo(p.x, p.y);
            }
            g.stroke({ color: 0xffff44, alpha: 0.5, width: 4 });

            // Inner bright line
            g.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) {
                g.lineTo(p.x, p.y);
            }
            g.stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
        }
    }

    drawDeathParticles() {
        const g = this.chainGraphics; // reuse
        for (const p of this.deathParticles) {
            const alpha = Math.min(1, p.life * 2);
            g.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
                .fill({ color: p.color, alpha });
        }
    }

    // ========== UI ==========

    createUI() {
        // Top bar background
        const topBar = new Graphics();
        topBar.rect(0, 0, CANVAS_WIDTH, UI_TOP_HEIGHT)
            .fill(0x16161e);
        this.uiLayer.addChild(topBar);

        const textStyle = new TextStyle({
            fontFamily: 'monospace',
            fontSize: 16,
            fill: '#ffffff',
        });

        // Gold
        this.goldText = new Text({ text: `💰 ${this.state.gold}`, style: { ...textStyle, fill: '#ffcc00' } });
        this.goldText.position.set(15, 15);
        this.uiLayer.addChild(this.goldText);

        // Health
        this.healthText = new Text({ text: `❤️ ${this.state.health}`, style: { ...textStyle, fill: '#ff4444' } });
        this.healthText.position.set(120, 15);
        this.uiLayer.addChild(this.healthText);

        // Wave
        this.waveText = new Text({ text: `Wave ${this.state.wave}`, style: textStyle });
        this.waveText.position.set(220, 15);
        this.uiLayer.addChild(this.waveText);

        // Pause indicator
        this.pauseText = new Text({ text: '', style: { ...textStyle, fill: '#ffaa00' } });
        this.pauseText.position.set(CANVAS_WIDTH - 180, 15);
        this.uiLayer.addChild(this.pauseText);

        // Next Wave button (right aligned in top bar)
        const waveBtn = new Container();
        waveBtn.position.set(CANVAS_WIDTH - 90, 8);

        const waveBtnBg = new Graphics();
        waveBtnBg.roundRect(0, 0, 80, 34, 6)
            .fill(0x44aa44);
        waveBtn.addChild(waveBtnBg);

        const waveBtnText = new Text({
            text: '⚔️ WAVE',
            style: { fontFamily: 'monospace', fontSize: 12, fill: '#ffffff', fontWeight: 'bold' }
        });
        waveBtnText.anchor.set(0.5, 0.5);
        waveBtnText.position.set(40, 17);
        waveBtn.addChild(waveBtnText);

        waveBtn.eventMode = 'static';
        waveBtn.cursor = 'pointer';
        waveBtn.hitArea = new Rectangle(0, 0, 80, 34);

        const triggerWave = (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.startWave();
        };
        waveBtn.on('pointerdown', triggerWave);
        waveBtn.on('pointertap', triggerWave);

        this.uiLayer.addChild(waveBtn);

        // Bottom bar
        const bottomBar = new Graphics();
        bottomBar.rect(0, GAME_HEIGHT + UI_TOP_HEIGHT, CANVAS_WIDTH, UI_BOTTOM_HEIGHT)
            .fill(0x16161e);
        this.uiLayer.addChild(bottomBar);

        // Tower buttons - larger for mobile touch
        const types: EmitterType[] = ['water', 'fire', 'electric', 'goo'];
        const buttonWidth = 70;
        const buttonHeight = 60;
        const buttonSpacing = 8;
        const startX = (CANVAS_WIDTH - (types.length * buttonWidth + (types.length - 1) * buttonSpacing)) / 2;

        types.forEach((type, i) => {
            const def = EMITTER_DEFS[type];
            const btn = new Container();
            btn.position.set(startX + i * (buttonWidth + buttonSpacing), GAME_HEIGHT + UI_TOP_HEIGHT + 10);

            const bg = new Graphics();
            bg.roundRect(0, 0, buttonWidth, buttonHeight, 8)
                .fill(0x333344);
            btn.addChild(bg);

            // Larger icon for visibility
            const icon = new Graphics();
            icon.circle(buttonWidth / 2, 22, 14)
                .fill(def.color);
            // Inner glow
            icon.circle(buttonWidth / 2 - 3, 19, 5)
                .fill({ color: 0xffffff, alpha: 0.3 });
            btn.addChild(icon);

            const cost = new Text({
                text: `$${def.cost}`,
                style: { fontFamily: 'monospace', fontSize: 14, fill: '#ffffff', fontWeight: 'bold' }
            });
            cost.anchor.set(0.5, 0);
            cost.position.set(buttonWidth / 2, 42);
            btn.addChild(cost);

            // Make button interactive with explicit hit area
            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            btn.hitArea = new Rectangle(0, 0, buttonWidth, buttonHeight);

            // Use both pointerdown and touchstart for maximum compatibility
            const selectTower = (e: FederatedPointerEvent) => {
                e.stopPropagation();
                this.setSelectedEmitterType(type);
            };
            btn.on('pointerdown', selectTower);
            btn.on('pointertap', selectTower);

            this.towerButtons.push(btn);
            this.uiLayer.addChild(btn);
        });
    }

    updateUI() {
        this.goldText.text = `💰 ${this.state.gold}`;
        this.healthText.text = `❤️ ${this.state.health}`;
        this.waveText.text = this.state.waveActive ? `Wave ${this.state.wave}` : `Wave ${this.state.wave} ✓`;
        this.pauseText.text = this.autoWaveEnabled ? '' : '⏸ PAUSED';

        // Update button highlights
        const types: EmitterType[] = ['water', 'fire', 'electric', 'goo'];
        types.forEach((type, i) => {
            const btn = this.towerButtons[i];
            const bg = btn.children[0] as Graphics;
            const def = EMITTER_DEFS[type];
            const canAfford = this.state.gold >= def.cost;
            const selected = this.state.selectedEmitterType === type;

            bg.clear();
            if (selected) {
                bg.roundRect(0, 0, 70, 60, 8).fill(0x446688);
                bg.roundRect(0, 0, 70, 60, 8).stroke({ color: 0x88aaff, width: 3 });
            } else if (canAfford) {
                bg.roundRect(0, 0, 70, 60, 8).fill(0x333344);
            } else {
                bg.roundRect(0, 0, 70, 60, 8).fill(0x222233);
            }
        });
    }

    // ========== Input ==========

    setupInput() {
        // Prevent touch scrolling/zooming on canvas
        const canvas = this.app.canvas;
        canvas.style.touchAction = 'none';
        canvas.style.userSelect = 'none';
        (canvas.style as any).webkitUserSelect = 'none';
        (canvas.style as any).webkitTouchCallout = 'none';

        // Make game container interactive for grid clicks
        this.gameContainer.eventMode = 'static';
        this.gameContainer.hitArea = new Rectangle(0, UI_TOP_HEIGHT, GAME_WIDTH, GAME_HEIGHT);

        // Grid interaction
        this.gameContainer.on('pointermove', this.onPointerMove.bind(this));
        this.gameContainer.on('pointerdown', this.onPointerDown.bind(this));
        this.gameContainer.on('pointertap', this.onPointerDown.bind(this));

        // Keyboard
        window.addEventListener('keydown', this.onKeyDown.bind(this));

        // Prevent default touch behaviors
        canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
        canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    onPointerMove(e: FederatedPointerEvent) {
        // Scale coordinates to game space
        const scale = (this.app as any).gameScale || 1;
        this.hoverCell = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
    }

    onPointerDown(e: FederatedPointerEvent) {
        // Scale coordinates to game space
        const scale = (this.app as any).gameScale || 1;
        const grid = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
        if (!grid) return;

        if (this.state.selectedEmitterType) {
            this.placeEmitter(grid.x, grid.y, this.state.selectedEmitterType);
        } else {
            const emitter = this.getEmitterAtGrid(grid.x, grid.y);
            if (emitter) {
                this.selectEmitter(emitter.data_.id);
            } else {
                this.selectEmitter(null);
            }
        }
    }

    onKeyDown(e: KeyboardEvent) {
        if (e.key === '1') this.setSelectedEmitterType('water');
        if (e.key === '2') this.setSelectedEmitterType('fire');
        if (e.key === '3') this.setSelectedEmitterType('electric');
        if (e.key === '4') this.setSelectedEmitterType('goo');
        if (e.key === 'Escape') {
            this.state.selectedEmitterType = null;
            this.selectEmitter(null);
        }
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!this.state.waveActive) {
                this.startWave();
            }
        }
        if (e.key === 'p' || e.key === 'P') {
            this.togglePause();
        }
    }

    // ========== Game Logic ==========

    update(dt: number) {
        if (this.state.gameOver) return;
        if (this.state.paused) return;

        const now = performance.now();

        // Process spawn queue
        this.processSpawnQueue(now);

        // Update all objects
        this.updateEnemies(dt);
        this.updateEmitters(dt);
        this.updateProjectiles(dt);
        this.updatePuddles(dt);
        this.updateChainEffects(dt);
        this.updateDeathParticles(dt);
        this.updateScreenShake(dt);

        // Draw dynamic elements
        this.drawBackground();
        this.drawNexus();
        this.drawChainEffects();
        this.drawDeathParticles();
        this.drawHoverCell();

        // Update UI
        this.updateUI();

        // Check wave completion
        this.checkWaveCompletion();

        // Game over
        if (this.state.health <= 0) {
            this.state.gameOver = true;
            this.showGameOver();
        }

        // Auto-wave
        if (this.autoWaveEnabled && !this.state.waveActive) {
            this.autoWaveTimer -= dt * 1000;
            if (this.autoWaveTimer <= 0) {
                this.startWave();
                this.autoWaveTimer = AUTO_WAVE_DELAY;
            }
        }
    }

    processSpawnQueue(now: number) {
        const toSpawn = this.state.spawnQueue.filter(s => now >= s.spawnAt);
        for (const s of toSpawn) {
            this.spawnEnemy(s.type);
        }
        this.state.spawnQueue = this.state.spawnQueue.filter(s => now < s.spawnAt);
    }

    updateEnemies(dt: number) {
        const toRemove: Enemy[] = [];

        for (const enemy of this.enemies) {
            // Check puddle slow effects
            for (const puddle of this.puddles) {
                if (puddle.containsPoint(enemy.x, enemy.y)) {
                    enemy.data_.slowFactor = Math.min(
                        enemy.data_.slowFactor,
                        puddle.data_.slowFactor
                    );
                }
            }

            const alive = enemy.update(dt);

            if (!alive) {
                if (enemy.reachedEnd()) {
                    this.state.health -= 1;
                    this.shake(0.01, 0.2);
                } else if (enemy.data_.health <= 0) {
                    this.state.gold += enemy.data_.reward;
                    const def = ENEMY_DEFS[enemy.data_.type];
                    this.spawnDeathExplosion(enemy.x, enemy.y, def.color, def.size);

                    // Splitter
                    if (def.splitCount && def.splitCount > 0) {
                        for (let i = 0; i < def.splitCount; i++) {
                            const angle = (Math.PI * 2 / def.splitCount) * i;
                            const offsetX = Math.cos(angle) * 15;
                            const offsetY = Math.sin(angle) * 15;
                            this.spawnEnemy('grunt', { x: enemy.x + offsetX, y: enemy.y + offsetY }, 0.5);
                        }
                    }

                    // Boss shake
                    if (enemy.data_.type === 'boss') {
                        this.shake(0.02, 0.4);
                    }
                }
                toRemove.push(enemy);
            }
        }

        for (const enemy of toRemove) {
            this.enemyLayer.removeChild(enemy);
            this.enemies = this.enemies.filter(e => e !== enemy);
        }
    }

    updateEmitters(dt: number) {
        for (const emitter of this.emitters) {
            emitter.update(dt);

            if (!emitter.canFire()) continue;

            const def = EMITTER_DEFS[emitter.data_.type];
            const range = emitter.getRange();
            const emitterPos = { x: emitter.x, y: emitter.y };

            // Find target
            let bestTarget: Enemy | null = null;
            let bestDist = Infinity;

            for (const enemy of this.enemies) {
                const dx = enemy.x - emitterPos.x;
                const dy = enemy.y - emitterPos.y;
                const d = Math.sqrt(dx * dx + dy * dy);

                if (d <= range && d < bestDist) {
                    bestDist = d;
                    bestTarget = enemy;
                }
            }

            if (!bestTarget) continue;

            // Lead targeting
            const target = bestTarget;
            const dx = target.x - emitterPos.x;
            const dy = target.y - emitterPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const timeToHit = dist / def.particleSpeed;

            let predictX = target.x;
            let predictY = target.y;

            const pathIdx = target.data_.pathIndex;
            const nextWaypoint = target.worldPath[pathIdx + 1];

            if (nextWaypoint) {
                const toDx = nextWaypoint.x - target.x;
                const toDy = nextWaypoint.y - target.y;
                const toDist = Math.sqrt(toDx * toDx + toDy * toDy);
                if (toDist > 0) {
                    const moveSpeed = target.data_.baseSpeed * (target.data_.slowTimer > 0 ? target.data_.slowFactor : 1);
                    const nx = toDx / toDist;
                    const ny = toDy / toDist;
                    predictX = target.x + nx * moveSpeed * timeToHit * 0.8;
                    predictY = target.y + ny * moveSpeed * timeToHit * 0.8;
                }
            }

            emitter.aimAt(predictX, predictY);
            emitter.fire();

            // Spawn projectiles
            const mult = getUpgradeMultiplier(emitter.data_.level);
            for (let i = 0; i < def.particlesPerShot; i++) {
                this.spawnProjectile(emitter, emitter.data_.angle, mult);
            }
        }
    }

    updateProjectiles(dt: number) {
        const toRemove: Projectile[] = [];

        for (const proj of this.projectiles) {
            const alive = proj.update(dt);

            if (!alive) {
                toRemove.push(proj);
                continue;
            }

            // Check collisions
            for (const enemy of this.enemies) {
                if (proj.hasHitEnemy(enemy.data_.id)) continue;

                const def = ENEMY_DEFS[enemy.data_.type];
                const dx = enemy.x - proj.x;
                const dy = enemy.y - proj.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < def.size + 6) {
                    proj.registerHit(enemy.data_.id);

                    const killed = enemy.takeDamage(proj.data_.damage);

                    if (!killed) {
                        // Knockback
                        const velMag = Math.sqrt(proj.velocity.x ** 2 + proj.velocity.y ** 2);
                        if (velMag > 0) {
                            const nx = proj.velocity.x / velMag;
                            const ny = proj.velocity.y / velMag;
                            enemy.applyKnockback(
                                nx * proj.data_.knockbackForce,
                                ny * proj.data_.knockbackForce
                            );
                        }

                        // Special effects
                        const emitterDef = EMITTER_DEFS[proj.data_.type];

                        if (emitterDef.dotDamage && emitterDef.dotDuration) {
                            enemy.applyDOT(emitterDef.dotDamage, emitterDef.dotDuration);
                        }

                        if (emitterDef.slowFactor && emitterDef.slowDuration) {
                            enemy.applySlow(emitterDef.slowFactor, emitterDef.slowDuration);
                        }

                        if (emitterDef.chainCount && emitterDef.chainCount > 0) {
                            this.chainLightning(enemy, proj.data_.damage * 0.6, emitterDef.chainCount);
                        }

                        if (emitterDef.puddleDuration) {
                            this.createOrExpandPuddle(proj.x, proj.y, emitterDef);
                        }
                    }

                    if (!proj.isAlive()) {
                        toRemove.push(proj);
                        break;
                    }
                }
            }
        }

        for (const proj of toRemove) {
            this.projectileLayer.removeChild(proj);
            this.projectiles = this.projectiles.filter(p => p !== proj);
        }
    }

    updatePuddles(dt: number) {
        const toRemove: Puddle[] = [];

        for (const puddle of this.puddles) {
            const alive = puddle.update(dt);
            if (!alive) {
                toRemove.push(puddle);
            }
        }

        for (const puddle of toRemove) {
            this.puddleLayer.removeChild(puddle);
            this.puddles = this.puddles.filter(p => p !== puddle);
        }
    }

    updateChainEffects(dt: number) {
        this.chainEffects = this.chainEffects.filter(e => {
            e.timer -= dt;
            return e.timer > 0;
        });
    }

    updateDeathParticles(dt: number) {
        this.deathParticles = this.deathParticles.filter(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 200 * dt;
            p.life -= dt;
            p.size *= 0.98;
            return p.life > 0 && p.size > 0.5;
        });
    }

    updateScreenShake(dt: number) {
        if (this.shakeDuration > 0) {
            this.shakeDuration -= dt;
            const offsetX = (Math.random() - 0.5) * this.shakeIntensity * CELL_SIZE * 10;
            const offsetY = (Math.random() - 0.5) * this.shakeIntensity * CELL_SIZE * 10;
            this.gameContainer.position.set(offsetX, offsetY);
        } else {
            this.gameContainer.position.set(0, 0);
        }
    }

    shake(intensity: number, duration: number) {
        this.shakeIntensity = intensity;
        this.shakeDuration = duration;
    }

    // ========== Spawning ==========

    spawnEnemy(type: EnemyType, pos?: Vec2, scale: number = 1) {
        const startPos = pos || { ...this.worldPath[0] };

        const enemy = new Enemy(
            startPos.x,
            startPos.y,
            this.state.nextId++,
            type,
            this.worldPath,
            this.state.wave,
            scale
        );

        this.enemies.push(enemy);
        this.enemyLayer.addChild(enemy);
    }

    spawnProjectile(emitter: Emitter, angle: number, mult: { damage: number; knockback: number }) {
        if (this.projectiles.length >= MAX_PARTICLES) return;

        const def = EMITTER_DEFS[emitter.data_.type];

        // Add spread
        const spreadAngle = angle + (Math.random() - 0.5) * def.spreadAngle;

        const vx = Math.cos(spreadAngle) * def.particleSpeed;
        const vy = Math.sin(spreadAngle) * def.particleSpeed;

        const proj = new Projectile(
            emitter.x,
            emitter.y,
            vx,
            vy,
            this.state.nextId++,
            def.type as ParticleType,
            def.damage * mult.damage,
            def.particlePierce,
            def.particleLifespan,
            def.knockbackForce * mult.knockback,
            def.color,
            3 + emitter.data_.level
        );

        this.projectiles.push(proj);
        this.projectileLayer.addChild(proj);
    }

    spawnDeathExplosion(x: number, y: number, color: number, size: number) {
        const count = Math.floor(8 + size * 0.5);
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
            const speed = 80 + Math.random() * 120;
            this.deathParticles.push({
                x: x + (Math.random() - 0.5) * size,
                y: y + (Math.random() - 0.5) * size,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 50,
                color: Math.random() > 0.3 ? color : this.lightenColor(color, 0.5),
                size: 3 + Math.random() * 4,
                life: 0.5 + Math.random() * 0.5,
            });
        }
    }

    // ========== Special Effects ==========

    chainLightning(startEnemy: Enemy, damage: number, maxChains: number) {
        let lastTarget = startEnemy;
        const hit = new Set<number>([startEnemy.data_.id]);

        for (let i = 0; i < maxChains; i++) {
            let nearest: Enemy | null = null;
            let nearestDist = 4 * CELL_SIZE;

            for (const enemy of this.enemies) {
                if (hit.has(enemy.data_.id)) continue;

                const dx = enemy.x - lastTarget.x;
                const dy = enemy.y - lastTarget.y;
                const d = Math.sqrt(dx * dx + dy * dy);

                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = enemy;
                }
            }

            if (!nearest) break;

            hit.add(nearest.data_.id);

            this.chainEffects.push({
                from: { x: lastTarget.x, y: lastTarget.y },
                to: { x: nearest.x, y: nearest.y },
                timer: 0.1,
            });

            nearest.takeDamage(damage);
            lastTarget = nearest;
        }
    }

    createOrExpandPuddle(x: number, y: number, emitterDef: any) {
        let expanded = false;
        for (const puddle of this.puddles) {
            const dx = puddle.data_.x - x;
            const dy = puddle.data_.y - y;
            if (dx * dx + dy * dy < 400) {
                puddle.expand(0.5, emitterDef.puddleDuration, 2, 40);
                expanded = true;
                break;
            }
        }

        if (!expanded) {
            const puddle = new Puddle(
                x,
                y,
                this.state.nextId++,
                15,
                emitterDef.puddleDuration,
                emitterDef.slowFactor,
                emitterDef.color
            );
            this.puddles.push(puddle);
            this.puddleLayer.addChild(puddle);
        }
    }

    // ========== Game Actions ==========

    startWave() {
        if (this.state.gameOver) return;

        // Allow overlapping waves - just increment and add more enemies
        this.state.wave++;
        this.state.waveActive = true;

        const waveDef = generateWave(this.state.wave);
        let totalDelay = 0;
        const now = performance.now();

        for (const entry of waveDef.enemies) {
            for (let i = 0; i < entry.count; i++) {
                this.state.spawnQueue.push({
                    type: entry.type,
                    spawnAt: now + totalDelay,
                });
                totalDelay += entry.delay;
            }
        }
    }

    checkWaveCompletion() {
        if (this.state.waveActive &&
            this.enemies.length === 0 &&
            this.state.spawnQueue.length === 0) {
            this.state.waveActive = false;
            const waveDef = generateWave(this.state.wave);
            this.state.gold += waveDef.reward;
        }
    }

    placeEmitter(gx: number, gy: number, type: EmitterType): boolean {
        if (!this.canPlaceEmitter(gx, gy)) return false;

        const def = EMITTER_DEFS[type];
        if (this.state.gold < def.cost) return false;

        this.state.gold -= def.cost;

        const emitter = new Emitter(gx, gy, this.state.nextId++, type);
        this.emitters.push(emitter);
        this.emitterLayer.addChild(emitter);
        this.occupiedCells.add(`${gx},${gy}`);

        return true;
    }

    selectEmitter(id: number | null) {
        for (const emitter of this.emitters) {
            emitter.setSelected(emitter.data_.id === id);
        }
        this.state.selectedEmitterId = id;
    }

    getEmitterAtGrid(gx: number, gy: number): Emitter | null {
        for (const emitter of this.emitters) {
            if (emitter.data_.gridX === gx && emitter.data_.gridY === gy) {
                return emitter;
            }
        }
        return null;
    }

    setSelectedEmitterType(type: EmitterType | null) {
        const def = type ? EMITTER_DEFS[type] : null;

        if (def && this.state.gold < def.cost) {
            return;
        }

        if (this.state.selectedEmitterType === type) {
            this.state.selectedEmitterType = null;
        } else {
            this.state.selectedEmitterType = type;
            this.selectEmitter(null);
        }
    }

    togglePause() {
        this.autoWaveEnabled = !this.autoWaveEnabled;
        this.state.paused = !this.autoWaveEnabled && !this.state.waveActive;
    }

    showGameOver() {
        const overlay = new Graphics();
        overlay.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            .fill({ color: 0x000000, alpha: 0.7 });
        this.uiLayer.addChild(overlay);

        const gameOverText = new Text({
            text: `GAME OVER\nWave ${this.state.wave}`,
            style: {
                fontFamily: 'monospace',
                fontSize: 32,
                fill: '#ff4444',
                align: 'center',
            }
        });
        gameOverText.anchor.set(0.5);
        gameOverText.position.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        this.uiLayer.addChild(gameOverText);

        const restartText = new Text({
            text: 'Tap to restart',
            style: {
                fontFamily: 'monospace',
                fontSize: 16,
                fill: '#aaaaaa',
            }
        });
        restartText.anchor.set(0.5);
        restartText.position.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
        this.uiLayer.addChild(restartText);

        overlay.eventMode = 'static';
        overlay.on('pointerdown', () => {
            window.location.reload();
        });
    }

    // ========== Helpers ==========

    lightenColor(color: number, factor: number): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }
}
