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
import { ParticleSystem, ProjectileData } from './objects/ParticleSystem';

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

    // Optimized particle system (batched rendering)
    particleSystem: ParticleSystem | null = null;
    useOptimizedParticles: boolean = true;

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
    deleteButton: Container | null = null;
    selectedPanel: Container | null = null;

    // Delete mode
    deleteMode: boolean = false;

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

        // Initialize optimized particle system
        if (this.useOptimizedParticles) {
            this.particleSystem = new ParticleSystem(app);
            // Add particle system container after projectile layer for proper z-order
            this.gameContainer.addChild(this.particleSystem.getContainer());
        }

        // Create graphics objects
        this.gridGraphics = new Graphics();
        this.gridLayer.addChild(this.gridGraphics);

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

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const key = `${x},${y}`;
                const isPath = this.pathCells.has(key);
                const isNexus = x === NEXUS_X && y === NEXUS_Y;

                if (isNexus) continue;

                let color: number;
                if (isPath) {
                    color = 0x3d3328;
                } else {
                    color = ((x + y) % 2 === 0) ? 0x2a3a2a : 0x253525;
                }

                g.rect(x * CELL_SIZE + 1, y * CELL_SIZE + 1 + UI_TOP_HEIGHT, CELL_SIZE - 2, CELL_SIZE - 2)
                    .fill(color);
            }
        }
    }

    drawNexus() {
        const g = this.nexusGraphics;
        g.clear();

        const cx = NEXUS_X * CELL_SIZE + CELL_SIZE / 2;
        const cy = NEXUS_Y * CELL_SIZE + CELL_SIZE / 2 + UI_TOP_HEIGHT;

        this.nexusPulse += 0.05;
        const pulse = 0.7 + Math.sin(this.nexusPulse) * 0.3;
        const glowRadius = CELL_SIZE * 0.8 * pulse;

        // Outer glow
        g.circle(cx, cy, glowRadius)
            .fill({ color: 0x2244aa, alpha: pulse * 0.3 });

        // Core
        g.circle(cx, cy, CELL_SIZE * 0.4)
            .fill(0x4488ff);

        // Inner shine
        g.circle(cx - 3, cy - 3, CELL_SIZE * 0.15)
            .fill(0x88bbff);
    }

    drawHoverCell() {
        const g = this.hoverGraphics;
        g.clear();

        if (!this.hoverCell) return;

        const existingEmitter = this.getEmitterAtGrid(this.hoverCell.x, this.hoverCell.y);

        if (this.deleteMode) {
            // Show delete indicator
            if (existingEmitter) {
                g.rect(
                    this.hoverCell.x * CELL_SIZE,
                    this.hoverCell.y * CELL_SIZE + UI_TOP_HEIGHT,
                    CELL_SIZE,
                    CELL_SIZE
                ).fill({ color: 0xff0000, alpha: 0.4 });
                g.rect(
                    this.hoverCell.x * CELL_SIZE + 1,
                    this.hoverCell.y * CELL_SIZE + 1 + UI_TOP_HEIGHT,
                    CELL_SIZE - 2,
                    CELL_SIZE - 2
                ).stroke({ color: 0xff0000, width: 3 });
            }
        } else if (this.state.selectedEmitterType) {
            if (existingEmitter && existingEmitter.data_.type === this.state.selectedEmitterType) {
                // Show upgrade indicator (yellow)
                const upgradeCost = getUpgradeCost(existingEmitter.data_.level);
                const canAfford = this.state.gold >= upgradeCost;
                const color = canAfford ? 0xffcc00 : 0xff6600;

                g.rect(
                    this.hoverCell.x * CELL_SIZE,
                    this.hoverCell.y * CELL_SIZE + UI_TOP_HEIGHT,
                    CELL_SIZE,
                    CELL_SIZE
                ).fill({ color, alpha: 0.3 });
                g.rect(
                    this.hoverCell.x * CELL_SIZE + 1,
                    this.hoverCell.y * CELL_SIZE + 1 + UI_TOP_HEIGHT,
                    CELL_SIZE - 2,
                    CELL_SIZE - 2
                ).stroke({ color, width: 2 });
            } else {
                // Show placement indicator
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
        // Optimized particle system renders death particles via GPU batching
        if (this.useOptimizedParticles && this.particleSystem) {
            return;
        }

        // Fallback to legacy Graphics-based rendering
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
            console.log('[Input] Wave button clicked');
            this.startWave();
        };
        waveBtn.on('pointertap', triggerWave);
        waveBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
        });

        this.uiLayer.addChild(waveBtn);

        // Bottom bar
        const bottomBar = new Graphics();
        bottomBar.rect(0, GAME_HEIGHT + UI_TOP_HEIGHT, CANVAS_WIDTH, UI_BOTTOM_HEIGHT)
            .fill(0x16161e);
        this.uiLayer.addChild(bottomBar);

        // Tower buttons - larger for better mobile touch
        const types: EmitterType[] = ['water', 'fire', 'electric', 'goo'];
        const buttonWidth = 70;
        const buttonHeight = 55;
        const buttonSpacing = 8;
        const deleteWidth = 50;
        const totalWidth = types.length * buttonWidth + (types.length - 1) * buttonSpacing + deleteWidth + buttonSpacing;
        const startX = (CANVAS_WIDTH - totalWidth) / 2;

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
            icon.circle(buttonWidth / 2, 20, 14)
                .fill(def.color);
            // Inner highlight
            icon.circle(buttonWidth / 2 - 4, 16, 5)
                .fill({ color: 0xffffff, alpha: 0.3 });
            btn.addChild(icon);

            const cost = new Text({
                text: `$${def.cost}`,
                style: { fontFamily: 'monospace', fontSize: 13, fill: '#ffffff', fontWeight: 'bold' }
            });
            cost.anchor.set(0.5, 0);
            cost.position.set(buttonWidth / 2, 38);
            btn.addChild(cost);

            // Make button interactive with explicit hit area
            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            btn.hitArea = new Rectangle(0, 0, buttonWidth, buttonHeight);

            // Use pointertap for reliable click on both desktop and mobile
            // pointertap fires after a quick pointerdown+pointerup sequence
            const selectTower = (e: FederatedPointerEvent) => {
                e.stopPropagation();
                console.log('[Input] Tower button clicked:', type);
                this.deleteMode = false;
                this.setSelectedEmitterType(type);
            };
            btn.on('pointertap', selectTower);
            // Also listen to pointerdown for immediate feedback on mobile
            btn.on('pointerdown', (e: FederatedPointerEvent) => {
                e.stopPropagation();
            });

            this.towerButtons.push(btn);
            this.uiLayer.addChild(btn);
        });

        // Delete button
        const deleteBtn = new Container();
        deleteBtn.position.set(startX + types.length * (buttonWidth + buttonSpacing), GAME_HEIGHT + UI_TOP_HEIGHT + 10);

        const deleteBg = new Graphics();
        deleteBg.roundRect(0, 0, deleteWidth, buttonHeight, 8)
            .fill(0x442222);
        deleteBtn.addChild(deleteBg);

        // X icon
        const deleteIcon = new Text({
            text: '✕',
            style: { fontFamily: 'monospace', fontSize: 20, fill: '#ff6666', fontWeight: 'bold' }
        });
        deleteIcon.anchor.set(0.5);
        deleteIcon.position.set(deleteWidth / 2, 20);
        deleteBtn.addChild(deleteIcon);

        const deleteLabel = new Text({
            text: 'DEL',
            style: { fontFamily: 'monospace', fontSize: 10, fill: '#aa6666' }
        });
        deleteLabel.anchor.set(0.5, 0);
        deleteLabel.position.set(deleteWidth / 2, 38);
        deleteBtn.addChild(deleteLabel);

        deleteBtn.eventMode = 'static';
        deleteBtn.cursor = 'pointer';
        deleteBtn.hitArea = new Rectangle(0, 0, deleteWidth, buttonHeight);

        // Use pointertap for reliable click on both desktop and mobile
        const toggleDelete = (e: FederatedPointerEvent) => {
            e.stopPropagation();
            console.log('[Input] Delete button clicked');
            this.deleteMode = !this.deleteMode;
            this.state.selectedEmitterType = null;
        };
        deleteBtn.on('pointertap', toggleDelete);
        deleteBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
        });

        this.deleteButton = deleteBtn;
        this.uiLayer.addChild(deleteBtn);
    }

    updateUI() {
        this.goldText.text = `💰 ${this.state.gold}`;
        this.healthText.text = `❤️ ${this.state.health}`;
        this.waveText.text = this.state.waveActive ? `Wave ${this.state.wave}` : `Wave ${this.state.wave} ✓`;
        this.pauseText.text = this.autoWaveEnabled ? '' : '⏸ PAUSED';

        const buttonWidth = 70;
        const buttonHeight = 55;

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
                bg.roundRect(0, 0, buttonWidth, buttonHeight, 8).fill(0x446688);
                bg.roundRect(0, 0, buttonWidth, buttonHeight, 8).stroke({ color: 0x88aaff, width: 3 });
            } else if (canAfford) {
                bg.roundRect(0, 0, buttonWidth, buttonHeight, 8).fill(0x333344);
            } else {
                bg.roundRect(0, 0, buttonWidth, buttonHeight, 8).fill(0x222233);
            }
        });

        // Update delete button highlight
        if (this.deleteButton) {
            const deleteBg = this.deleteButton.children[0] as Graphics;
            deleteBg.clear();
            if (this.deleteMode) {
                deleteBg.roundRect(0, 0, 50, buttonHeight, 8).fill(0x662222);
                deleteBg.roundRect(0, 0, 50, buttonHeight, 8).stroke({ color: 0xff6666, width: 3 });
            } else {
                deleteBg.roundRect(0, 0, 50, buttonHeight, 8).fill(0x442222);
            }
        }
    }

    // ========== Input ==========

    setupInput() {
        // Prevent touch scrolling/zooming on canvas
        const canvas = this.app.canvas;
        canvas.style.touchAction = 'none';
        canvas.style.userSelect = 'none';
        (canvas.style as any).webkitUserSelect = 'none';
        (canvas.style as any).webkitTouchCallout = 'none';

        // Make stage interactive for all pointer events
        // Use 'dynamic' for better mobile touch support
        this.app.stage.eventMode = 'static';
        // Hit area needs to cover the full game area in game coordinates (before scale)
        this.app.stage.hitArea = new Rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        // Enable interactivity on children by default
        this.app.stage.interactiveChildren = true;

        // CRITICAL: For mobile, we need pointerdown to track that a touch started
        // pointerup alone won't work reliably on mobile without a preceding pointerdown
        this.app.stage.on('pointerdown', this.onPointerDown.bind(this));
        this.app.stage.on('pointermove', this.onPointerMove.bind(this));
        this.app.stage.on('pointerup', this.onPointerUp.bind(this));
        // Also handle pointercancel for edge cases
        this.app.stage.on('pointercancel', this.onPointerCancel.bind(this));

        // Keyboard
        window.addEventListener('keydown', this.onKeyDown.bind(this));

        // Prevent default touch behaviors on canvas
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });

        // Debug: log that input is set up
        console.log('[Input] Setup complete, stage eventMode:', this.app.stage.eventMode);
    }

    // Track if pointer is down (needed for reliable mobile touch)
    private pointerDown = false;

    onPointerDown(e: FederatedPointerEvent) {
        this.pointerDown = true;
        // Update hover position on touch start too
        const scale = (this.app as any).gameScale || 1;
        this.hoverCell = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
        console.log('[Input] pointerdown at', e.globalX, e.globalY, 'grid:', this.hoverCell);
    }

    onPointerCancel(e: FederatedPointerEvent) {
        this.pointerDown = false;
        console.log('[Input] pointercancel');
    }

    onPointerMove(e: FederatedPointerEvent) {
        // Scale coordinates to game space
        const scale = (this.app as any).gameScale || 1;
        this.hoverCell = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
    }

    onPointerUp(e: FederatedPointerEvent) {
        console.log('[Input] pointerup at', e.globalX, e.globalY, 'wasDown:', this.pointerDown);
        this.pointerDown = false;

        // Scale coordinates to game space
        const scale = (this.app as any).gameScale || 1;
        const grid = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
        console.log('[Input] grid:', grid, 'scale:', scale);
        if (!grid) return;

        // Check for existing emitter at this location
        const existingEmitter = this.getEmitterAtGrid(grid.x, grid.y);

        if (this.deleteMode) {
            // Delete mode - remove the emitter
            if (existingEmitter) {
                this.deleteEmitter(existingEmitter);
            }
            return;
        }

        if (this.state.selectedEmitterType) {
            if (existingEmitter) {
                // If same type, upgrade it
                if (existingEmitter.data_.type === this.state.selectedEmitterType) {
                    this.upgradeEmitter(existingEmitter);
                }
                // If different type, do nothing (can't replace)
            } else {
                // Place new emitter
                this.placeEmitter(grid.x, grid.y, this.state.selectedEmitterType);
            }
        } else {
            // No tower selected - just select the emitter
            if (existingEmitter) {
                this.selectEmitter(existingEmitter.data_.id);
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
        // Use optimized particle system if available
        if (this.useOptimizedParticles && this.particleSystem) {
            this.updateOptimizedProjectiles(dt);
            return;
        }

        // Fallback to legacy projectile system
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

    /**
     * Optimized projectile update using batched ParticleContainer
     */
    updateOptimizedProjectiles(dt: number) {
        if (!this.particleSystem) return;

        // Update particle system physics
        this.particleSystem.update(dt);

        // Check collisions for all active projectiles
        const projectiles = this.particleSystem.getProjectiles();

        for (const proj of projectiles) {
            if (!proj.active) continue;

            // Check collisions with enemies
            for (const enemy of this.enemies) {
                if (this.particleSystem.hasHitEnemy(proj, enemy.data_.id)) continue;

                const def = ENEMY_DEFS[enemy.data_.type];
                const dx = enemy.x - proj.x;
                const dy = enemy.y - proj.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < def.size + 6) {
                    this.particleSystem.registerHit(proj, enemy.data_.id);

                    const killed = enemy.takeDamage(proj.damage);

                    if (!killed) {
                        // Knockback
                        const velMag = Math.sqrt(proj.vx ** 2 + proj.vy ** 2);
                        if (velMag > 0) {
                            const nx = proj.vx / velMag;
                            const ny = proj.vy / velMag;
                            enemy.applyKnockback(
                                nx * proj.knockbackForce,
                                ny * proj.knockbackForce
                            );
                        }

                        // Special effects
                        const emitterDef = EMITTER_DEFS[proj.type];

                        if (emitterDef.dotDamage && emitterDef.dotDuration) {
                            enemy.applyDOT(emitterDef.dotDamage, emitterDef.dotDuration);
                        }

                        if (emitterDef.slowFactor && emitterDef.slowDuration) {
                            enemy.applySlow(emitterDef.slowFactor, emitterDef.slowDuration);
                        }

                        if (emitterDef.chainCount && emitterDef.chainCount > 0) {
                            this.chainLightning(enemy, proj.damage * 0.6, emitterDef.chainCount);
                        }

                        if (emitterDef.puddleDuration) {
                            this.createOrExpandPuddle(proj.x, proj.y, emitterDef);
                        }
                    }

                    // Check if projectile should be removed
                    if (proj.pierce <= 0) {
                        this.particleSystem.removeProjectile(proj);
                        break;
                    }
                }
            }
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
        // Optimized particle system handles death particles internally
        if (this.useOptimizedParticles && this.particleSystem) {
            // Already updated in particleSystem.update()
            return;
        }

        // Fallback to legacy system
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
        // Use optimized particle system if available
        if (this.useOptimizedParticles && this.particleSystem) {
            if (this.particleSystem.projectileCount >= MAX_PARTICLES) return;

            const def = EMITTER_DEFS[emitter.data_.type];

            // Add spread
            const spreadAngle = angle + (Math.random() - 0.5) * def.spreadAngle;

            const vx = Math.cos(spreadAngle) * def.particleSpeed;
            const vy = Math.sin(spreadAngle) * def.particleSpeed;

            this.particleSystem.spawnProjectile(
                emitter.x,
                emitter.y,
                vx,
                vy,
                def.type as ParticleType,
                def.damage * mult.damage,
                def.particlePierce,
                def.particleLifespan,
                def.knockbackForce * mult.knockback,
                def.color,
                3 + emitter.data_.level,
                emitter.data_.id
            );
            return;
        }

        // Fallback to legacy system
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
        // Use optimized particle system if available
        if (this.useOptimizedParticles && this.particleSystem) {
            this.particleSystem.spawnDeathExplosion(x, y, color, size);
            return;
        }

        // Fallback to legacy system
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

    upgradeEmitter(emitter: Emitter): boolean {
        const cost = getUpgradeCost(emitter.data_.level);
        if (this.state.gold < cost) return false;

        this.state.gold -= cost;
        emitter.data_.level++;
        emitter.redraw(); // Redraw with new level indicator

        return true;
    }

    deleteEmitter(emitter: Emitter): void {
        // Remove from occupied cells
        this.occupiedCells.delete(`${emitter.data_.gridX},${emitter.data_.gridY}`);

        // Remove from arrays
        this.emitters = this.emitters.filter(e => e !== emitter);
        this.emitterLayer.removeChild(emitter);

        // Refund some gold (50% of base cost)
        const def = EMITTER_DEFS[emitter.data_.type];
        const refund = Math.floor(def.cost * 0.5);
        this.state.gold += refund;

        // Deselect if this was selected
        if (this.state.selectedEmitterId === emitter.data_.id) {
            this.selectEmitter(null);
        }
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
