/**
 * GameECS - ECS-Based Game Implementation
 *
 * This is a full ECS refactor of the Game class, designed to support 1000+ enemies
 * and 1000+ particles smoothly through data-oriented design.
 *
 * Key differences from original Game.ts:
 * - All game state lives in typed arrays (ECSWorld)
 * - Systems are pure functions operating on arrays
 * - Rendering is a separate sync step (EnemyRenderer, ProjectileRenderer)
 * - Minimal GC pressure through array reuse
 */

import { Application, Container, Graphics, Text, FederatedPointerEvent, TextStyle, Rectangle } from 'pixi.js';
import {
    GRID_SIZE, CELL_SIZE, GAME_WIDTH, GAME_HEIGHT, UI_TOP_HEIGHT, UI_BOTTOM_HEIGHT,
    PATH, NEXUS_X, NEXUS_Y, getPathCells,
    EMITTER_DEFS, ENEMY_DEFS, getUpgradeMultiplier,
    STARTING_GOLD, STARTING_HEALTH, generateWave, getUpgradeCost,
    AUTO_WAVE_DELAY, CANVAS_WIDTH, CANVAS_HEIGHT
} from './config';
import { GameState, EmitterType, EnemyType, Vec2, ParticleType } from './types';
import { Emitter } from './objects/Emitter';
import { Puddle } from './objects/Puddle';

// ECS imports
import {
    ECSWorld,
    EnemyRenderer,
    ProjectileRenderer,
    updateEnemyMovement,
    updateProjectileMovement,
    updateDeathParticleMovement,
    processDOT,
    processFlashTimers,
    collectDeaths,
    EnemyDeathResult,
    detectCollisions,
    processCollisions,
    updateTargeting,
    updateFiring,
    FireResult,
    CollisionEvent,
    EF_SPLITTER,
    PF_DOT, PF_SLOW, PF_CHAIN, PF_PUDDLE,
    ENEMY_TYPE_REVERSE,
    PROJECTILE_TYPE_REVERSE,
    PROJECTILE_ARCHETYPES,
} from './ecs';
import { EMITTER_TYPE_REVERSE } from './ecs/archetypes';
import { SpatialHash, SpatialEntity } from './SpatialHash';

export class GameECS {
    app: Application;

    // Layers
    gridLayer: Container;
    puddleLayer: Container;
    emitterLayer: Container;
    enemyLayer: Container;
    projectileLayer: Container;
    effectLayer: Container;
    uiLayer: Container;

    // ECS World (all game state)
    world: ECSWorld;

    // Renderers (bridge ECS to PixiJS)
    enemyRenderer: EnemyRenderer;
    projectileRenderer: ProjectileRenderer;

    // Legacy objects (emitters and puddles still use OOP for now)
    emitters: Emitter[] = [];
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
    deleteButton: Container | null = null;

    // Delete mode
    deleteMode: boolean = false;

    // Hover/Selection
    hoverCell: { x: number; y: number } | null = null;

    // Effects
    chainEffects: Array<{ from: Vec2; to: Vec2; timer: number }> = [];
    nexusPulse: number = 0;

    // Auto-wave
    autoWaveTimer: number = AUTO_WAVE_DELAY;
    autoWaveEnabled: boolean = true;

    // Screen shake
    shakeIntensity: number = 0;
    shakeDuration: number = 0;

    // Game container (for shake offset)
    gameContainer: Container;

    // Spatial hash for puddles (enemies use ECS spatial hash)
    puddleSpatialHash: SpatialHash<Puddle>;

    // Reusable arrays to avoid per-frame allocations
    private reachedEndIndices: number[] = [];
    private dotKilledIndices: number[] = [];
    private collisionKilledIndices: number[] = [];
    private deadProjectileIndices: number[] = [];
    private deadParticleIndices: number[] = [];
    private collisionEvents: CollisionEvent[] = [];
    private fireResults: FireResult[] = [];
    private deathResults: EnemyDeathResult[] = [];
    private puddlesToRemove: Puddle[] = [];
    private chainHitSet: Set<number> = new Set();

    // Bounds for projectile culling
    private projectileBounds = {
        minX: -50,
        maxX: CANVAS_WIDTH + 50,
        minY: -50,
        maxY: CANVAS_HEIGHT + 50,
    };

    constructor(app: Application) {
        this.app = app;

        // Initialize ECS world
        this.world = new ECSWorld();

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
        this.world.setWorldPath(this.worldPath);

        // Initialize spatial hash for puddles
        this.puddleSpatialHash = new SpatialHash<Puddle>(64);

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

        // Initialize renderers
        this.enemyRenderer = new EnemyRenderer(this.enemyLayer);
        this.projectileRenderer = new ProjectileRenderer(app);
        this.gameContainer.addChild(this.projectileRenderer.getContainer());

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

        g.circle(cx, cy, glowRadius)
            .fill({ color: 0x2244aa, alpha: pulse * 0.3 });
        g.circle(cx, cy, CELL_SIZE * 0.4)
            .fill(0x4488ff);
        g.circle(cx - 3, cy - 3, CELL_SIZE * 0.15)
            .fill(0x88bbff);
    }

    drawHoverCell() {
        const g = this.hoverGraphics;
        g.clear();

        if (!this.hoverCell) return;

        const existingEmitter = this.getEmitterAtGrid(this.hoverCell.x, this.hoverCell.y);

        if (this.deleteMode) {
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

            const points: Vec2[] = [effect.from];
            for (let i = 1; i < segments; i++) {
                const t = i / segments;
                points.push({
                    x: effect.from.x + (effect.to.x - effect.from.x) * t + (Math.random() - 0.5) * jitter,
                    y: effect.from.y + (effect.to.y - effect.from.y) * t + (Math.random() - 0.5) * jitter,
                });
            }
            points.push(effect.to);

            g.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) {
                g.lineTo(p.x, p.y);
            }
            g.stroke({ color: 0xffff44, alpha: 0.5, width: 4 });

            g.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1)) {
                g.lineTo(p.x, p.y);
            }
            g.stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
        }
    }

    // ========== UI ==========

    createUI() {
        const topBar = new Graphics();
        topBar.rect(0, 0, CANVAS_WIDTH, UI_TOP_HEIGHT).fill(0x16161e);
        this.uiLayer.addChild(topBar);

        const textStyle = new TextStyle({
            fontFamily: 'monospace',
            fontSize: 16,
            fill: '#ffffff',
        });

        this.goldText = new Text({ text: `$ ${this.state.gold}`, style: { ...textStyle, fill: '#ffcc00' } });
        this.goldText.position.set(15, 15);
        this.uiLayer.addChild(this.goldText);

        this.healthText = new Text({ text: `HP ${this.state.health}`, style: { ...textStyle, fill: '#ff4444' } });
        this.healthText.position.set(120, 15);
        this.uiLayer.addChild(this.healthText);

        this.waveText = new Text({ text: `Wave ${this.state.wave}`, style: textStyle });
        this.waveText.position.set(220, 15);
        this.uiLayer.addChild(this.waveText);

        this.pauseText = new Text({ text: '', style: { ...textStyle, fill: '#ffaa00' } });
        this.pauseText.position.set(CANVAS_WIDTH - 180, 15);
        this.uiLayer.addChild(this.pauseText);

        // Next Wave button
        const waveBtn = new Container();
        waveBtn.position.set(CANVAS_WIDTH - 90, 8);

        const waveBtnBg = new Graphics();
        waveBtnBg.roundRect(0, 0, 80, 34, 6).fill(0x44aa44);
        waveBtn.addChild(waveBtnBg);

        const waveBtnText = new Text({
            text: 'WAVE',
            style: { fontFamily: 'monospace', fontSize: 12, fill: '#ffffff', fontWeight: 'bold' }
        });
        waveBtnText.anchor.set(0.5, 0.5);
        waveBtnText.position.set(40, 17);
        waveBtn.addChild(waveBtnText);

        waveBtn.eventMode = 'static';
        waveBtn.cursor = 'pointer';
        waveBtn.hitArea = new Rectangle(0, 0, 80, 34);
        waveBtn.on('pointertap', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.startWave();
        });
        waveBtn.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
        this.uiLayer.addChild(waveBtn);

        // Bottom bar
        const bottomBar = new Graphics();
        bottomBar.rect(0, GAME_HEIGHT + UI_TOP_HEIGHT, CANVAS_WIDTH, UI_BOTTOM_HEIGHT).fill(0x16161e);
        this.uiLayer.addChild(bottomBar);

        // Tower buttons
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
            bg.roundRect(0, 0, buttonWidth, buttonHeight, 8).fill(0x333344);
            btn.addChild(bg);

            const icon = new Graphics();
            icon.circle(buttonWidth / 2, 20, 14).fill(def.color);
            icon.circle(buttonWidth / 2 - 4, 16, 5).fill({ color: 0xffffff, alpha: 0.3 });
            btn.addChild(icon);

            const cost = new Text({
                text: `$${def.cost}`,
                style: { fontFamily: 'monospace', fontSize: 13, fill: '#ffffff', fontWeight: 'bold' }
            });
            cost.anchor.set(0.5, 0);
            cost.position.set(buttonWidth / 2, 38);
            btn.addChild(cost);

            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            btn.hitArea = new Rectangle(0, 0, buttonWidth, buttonHeight);
            btn.on('pointertap', (e: FederatedPointerEvent) => {
                e.stopPropagation();
                this.deleteMode = false;
                this.setSelectedEmitterType(type);
            });
            btn.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());

            this.towerButtons.push(btn);
            this.uiLayer.addChild(btn);
        });

        // Delete button
        const deleteBtn = new Container();
        deleteBtn.position.set(startX + types.length * (buttonWidth + buttonSpacing), GAME_HEIGHT + UI_TOP_HEIGHT + 10);

        const deleteBg = new Graphics();
        deleteBg.roundRect(0, 0, deleteWidth, buttonHeight, 8).fill(0x442222);
        deleteBtn.addChild(deleteBg);

        const deleteIcon = new Text({
            text: 'X',
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
        deleteBtn.on('pointertap', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.deleteMode = !this.deleteMode;
            this.state.selectedEmitterType = null;
        });
        deleteBtn.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());

        this.deleteButton = deleteBtn;
        this.uiLayer.addChild(deleteBtn);
    }

    updateUI() {
        this.goldText.text = `$ ${this.state.gold}`;
        this.healthText.text = `HP ${this.state.health}`;
        this.waveText.text = this.state.waveActive ? `Wave ${this.state.wave}` : `Wave ${this.state.wave} OK`;
        this.pauseText.text = this.autoWaveEnabled ? '' : 'PAUSED';

        const buttonWidth = 70;
        const buttonHeight = 55;

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
        const canvas = this.app.canvas;
        canvas.style.touchAction = 'none';
        canvas.style.userSelect = 'none';
        (canvas.style as any).webkitUserSelect = 'none';
        (canvas.style as any).webkitTouchCallout = 'none';

        this.app.stage.eventMode = 'static';
        this.app.stage.hitArea = new Rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        this.app.stage.interactiveChildren = true;

        this.app.stage.on('pointerdown', this.onPointerDown.bind(this));
        this.app.stage.on('pointermove', this.onPointerMove.bind(this));
        this.app.stage.on('pointerup', this.onPointerUp.bind(this));
        this.app.stage.on('pointercancel', () => { this.pointerDown = false; });

        window.addEventListener('keydown', this.onKeyDown.bind(this));
        canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        canvas.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        canvas.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    }

    private pointerDown = false;

    onPointerDown(e: FederatedPointerEvent) {
        this.pointerDown = true;
        const scale = (this.app as any).gameScale || 1;
        this.hoverCell = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
    }

    onPointerMove(e: FederatedPointerEvent) {
        const scale = (this.app as any).gameScale || 1;
        this.hoverCell = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
    }

    onPointerUp(e: FederatedPointerEvent) {
        this.pointerDown = false;

        const scale = (this.app as any).gameScale || 1;
        const grid = this.pixelToGrid(e.globalX / scale, e.globalY / scale);
        if (!grid) return;

        const existingEmitter = this.getEmitterAtGrid(grid.x, grid.y);

        if (this.deleteMode) {
            if (existingEmitter) {
                this.deleteEmitter(existingEmitter);
            }
            return;
        }

        if (this.state.selectedEmitterType) {
            if (existingEmitter) {
                if (existingEmitter.data_.type === this.state.selectedEmitterType) {
                    this.upgradeEmitter(existingEmitter);
                }
            } else {
                this.placeEmitter(grid.x, grid.y, this.state.selectedEmitterType);
            }
        } else {
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

    onWheel(e: WheelEvent) {
        e.preventDefault();
        if (e.deltaY < 0 && this.hoverCell) {
            const emitter = this.getEmitterAtGrid(this.hoverCell.x, this.hoverCell.y);
            if (emitter) {
                this.upgradeEmitter(emitter);
            }
        }
    }

    // ========== Main Game Loop ==========

    update(dt: number) {
        if (this.state.gameOver) return;
        if (this.state.paused) return;

        const now = performance.now();

        // Sync next ID with ECS world
        this.world.setNextId(this.state.nextId);

        // Process spawn queue
        this.processSpawnQueue(now);

        // Update spatial hash for enemies
        this.world.updateEnemySpatialHash();

        // Apply puddle effects to enemies
        this.applyPuddleEffects();

        // Run ECS systems
        this.runEnemySystems(dt);
        this.runEmitterSystems(dt);
        this.runProjectileSystems(dt);
        this.runParticleSystems(dt);

        // Update puddles (still OOP)
        this.updatePuddles(dt);

        // Update chain effects
        this.updateChainEffects(dt);

        // Update screen shake
        this.updateScreenShake(dt);

        // Sync renderers with ECS data
        this.enemyRenderer.sync(this.world.enemies);
        this.projectileRenderer.syncProjectiles(this.world.projectiles);
        this.projectileRenderer.syncDeathParticles(this.world.deathParticles);

        // Draw dynamic elements
        this.drawNexus();
        this.drawChainEffects();
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

        // Sync next ID back
        this.state.nextId = this.world.getNextId();
    }

    // ========== ECS Systems ==========

    private runEnemySystems(dt: number): void {
        const enemies = this.world.enemies;

        // Process flash timers
        processFlashTimers(enemies, dt);

        // Process DOT
        processDOT(enemies, dt, this.dotKilledIndices);

        // Movement system
        updateEnemyMovement(enemies, this.worldPath, dt, this.reachedEndIndices);

        // Collect deaths
        collectDeaths(enemies, this.dotKilledIndices, this.reachedEndIndices, this.deathResults);

        // Process deaths (reverse order to handle swap-remove correctly)
        this.deathResults.sort((a, b) => b.index - a.index);

        for (const death of this.deathResults) {
            if (death.reachedEnd) {
                this.state.health -= 1;
                this.shake(0.01, 0.2);
            } else {
                this.state.gold += death.reward;
                this.world.spawnDeathExplosion(death.x, death.y, death.color, death.size);

                // Handle splitter
                const arch = this.world.getEnemyArchetype(death.typeId);
                if (arch && arch.splitCount && arch.splitCount > 0) {
                    for (let i = 0; i < arch.splitCount; i++) {
                        const angle = (Math.PI * 2 / arch.splitCount) * i;
                        const offsetX = Math.cos(angle) * 15;
                        const offsetY = Math.sin(angle) * 15;
                        this.world.spawnEnemy('grunt', death.x + offsetX, death.y + offsetY, this.state.wave, 0.5);
                    }
                }

                // Boss shake
                if (ENEMY_TYPE_REVERSE[death.typeId] === 'boss') {
                    this.shake(0.02, 0.4);
                }
            }

            this.world.removeEnemyAt(death.index);
        }
    }

    private runEmitterSystems(dt: number): void {
        // Update emitter targeting and firing using ECS data
        // Note: Emitters still use OOP containers for now, but targeting uses ECS enemy data

        for (const emitter of this.emitters) {
            emitter.update(dt);

            const def = EMITTER_DEFS[emitter.data_.type];
            const range = emitter.getRange();

            // Find target using spatial hash
            let bestTarget = -1;
            let bestDistSq = range * range;

            const nearbyEnemies = this.world.getEnemiesNear(emitter.x, emitter.y);
            const enemies = this.world.enemies;

            for (const ei of nearbyEnemies) {
                const dx = enemies.x[ei] - emitter.x;
                const dy = enemies.y[ei] - emitter.y;
                const distSq = dx * dx + dy * dy;

                if (distSq <= bestDistSq) {
                    bestDistSq = distSq;
                    bestTarget = ei;
                }
            }

            if (bestTarget < 0) {
                emitter.resetFireAccumulator();
                continue;
            }

            // Lead targeting
            const targetX = enemies.x[bestTarget];
            const targetY = enemies.y[bestTarget];
            const dx = targetX - emitter.x;
            const dy = targetY - emitter.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const timeToHit = dist / def.particleSpeed;

            let predictX = targetX;
            let predictY = targetY;

            // Simple prediction based on enemy speed (would need path direction for better prediction)
            emitter.aimAt(predictX, predictY);

            // Fire
            const fireCount = emitter.getFireCount();
            const mult = getUpgradeMultiplier(emitter.data_.level);

            for (let shot = 0; shot < fireCount; shot++) {
                emitter.fire();

                for (let p = 0; p < def.particlesPerShot; p++) {
                    const angle = emitter.data_.angle + (Math.random() - 0.5) * def.spreadAngle;
                    const vx = Math.cos(angle) * def.particleSpeed;
                    const vy = Math.sin(angle) * def.particleSpeed;

                    this.world.spawnProjectile(
                        def.type,
                        emitter.x,
                        emitter.y,
                        vx,
                        vy,
                        def.damage * mult.damage,
                        def.knockbackForce * mult.knockback,
                        3 + emitter.data_.level,
                        emitter.data_.id
                    );
                }
            }
        }
    }

    private runProjectileSystems(dt: number): void {
        const projectiles = this.world.projectiles;
        const enemies = this.world.enemies;

        // Movement
        updateProjectileMovement(projectiles, dt, this.deadProjectileIndices, this.projectileBounds);

        // Collision detection
        detectCollisions(
            projectiles,
            enemies,
            (x, y) => this.world.getEnemiesNear(x, y),
            (pi, eid) => this.world.hasHitEnemy(pi, eid),
            this.collisionEvents
        );

        // Process collisions
        this.collisionKilledIndices.length = 0;

        for (const collision of this.collisionEvents) {
            const pi = collision.projectileIndex;
            const ei = collision.enemyIndex;

            // Register hit
            this.world.registerHit(pi, enemies.id[ei]);

            // Apply damage
            const killed = this.world.damageEnemy(ei, projectiles.damage[pi]);

            if (killed) {
                this.collisionKilledIndices.push(ei);
            } else {
                // Knockback
                const velMagSq = projectiles.vx[pi] ** 2 + projectiles.vy[pi] ** 2;
                if (velMagSq > 0) {
                    const velMag = Math.sqrt(velMagSq);
                    const nx = projectiles.vx[pi] / velMag;
                    const ny = projectiles.vy[pi] / velMag;
                    this.world.knockbackEnemy(ei, nx * projectiles.knockbackForce[pi], ny * projectiles.knockbackForce[pi]);
                }

                // Effects
                const arch = PROJECTILE_ARCHETYPES[projectiles.type[pi]];
                if (arch) {
                    if (arch.dotDamage && arch.dotDuration) {
                        this.world.applyDOT(ei, arch.dotDamage, arch.dotDuration);
                    }
                    if (arch.slowFactor && arch.slowDuration) {
                        this.world.applySlow(ei, arch.slowFactor, arch.slowDuration);
                    }
                    if (arch.chainCount && arch.chainCount > 0) {
                        this.chainLightning(ei, projectiles.damage[pi] * 0.6, arch.chainCount);
                    }
                    if (arch.puddleDuration) {
                        const typeName = PROJECTILE_TYPE_REVERSE[projectiles.type[pi]];
                        const emitterDef = EMITTER_DEFS[typeName];
                        this.createOrExpandPuddle(projectiles.x[pi], projectiles.y[pi], emitterDef);
                    }
                }
            }

            // Check if projectile should be removed
            if (projectiles.pierce[pi] <= 0) {
                if (!this.deadProjectileIndices.includes(pi)) {
                    this.deadProjectileIndices.push(pi);
                }
            }
        }

        // Process deaths from collisions
        const uniqueKilled = [...new Set(this.collisionKilledIndices)].sort((a, b) => b - a);
        for (const ei of uniqueKilled) {
            this.state.gold += enemies.reward[ei];
            this.world.spawnDeathExplosion(enemies.x[ei], enemies.y[ei], enemies.color[ei], enemies.size[ei]);

            const arch = this.world.getEnemyArchetype(enemies.type[ei]);
            if (arch && arch.splitCount && arch.splitCount > 0) {
                for (let i = 0; i < arch.splitCount; i++) {
                    const angle = (Math.PI * 2 / arch.splitCount) * i;
                    const offsetX = Math.cos(angle) * 15;
                    const offsetY = Math.sin(angle) * 15;
                    this.world.spawnEnemy('grunt', enemies.x[ei] + offsetX, enemies.y[ei] + offsetY, this.state.wave, 0.5);
                }
            }

            if (ENEMY_TYPE_REVERSE[enemies.type[ei]] === 'boss') {
                this.shake(0.02, 0.4);
            }

            this.world.removeEnemyAt(ei);
        }

        // Remove dead projectiles (reverse order for swap-remove)
        this.deadProjectileIndices.sort((a, b) => b - a);
        for (const pi of this.deadProjectileIndices) {
            this.projectileRenderer.onProjectileRemoved(pi);
            this.world.removeProjectileAt(pi);
        }
    }

    private runParticleSystems(dt: number): void {
        updateDeathParticleMovement(this.world.deathParticles, dt, this.deadParticleIndices);

        // Remove dead particles (reverse order)
        this.deadParticleIndices.sort((a, b) => b - a);
        for (const i of this.deadParticleIndices) {
            this.world.removeDeathParticleAt(i);
        }
    }

    private applyPuddleEffects(): void {
        const enemies = this.world.enemies;

        for (let i = 0; i < enemies.count; i++) {
            const nearbyPuddles = this.puddleSpatialHash.getNearby(enemies.x[i], enemies.y[i]);
            for (const puddle of nearbyPuddles) {
                if (puddle.containsPoint(enemies.x[i], enemies.y[i])) {
                    enemies.slowFactor[i] = Math.min(enemies.slowFactor[i], puddle.data_.slowFactor);
                }
            }
        }
    }

    // ========== Legacy Systems ==========

    processSpawnQueue(now: number) {
        const toSpawn = this.state.spawnQueue.filter(s => now >= s.spawnAt);
        for (const s of toSpawn) {
            this.spawnEnemy(s.type);
        }
        this.state.spawnQueue = this.state.spawnQueue.filter(s => now < s.spawnAt);
    }

    updatePuddles(dt: number) {
        this.puddlesToRemove.length = 0;

        for (const puddle of this.puddles) {
            const alive = puddle.update(dt);
            if (!alive) {
                this.puddlesToRemove.push(puddle);
            }
        }

        for (const puddle of this.puddlesToRemove) {
            this.puddleLayer.removeChild(puddle);
            this.puddleSpatialHash.remove(puddle);

            const idx = this.puddles.indexOf(puddle);
            if (idx !== -1) {
                const last = this.puddles.pop()!;
                if (idx < this.puddles.length) {
                    this.puddles[idx] = last;
                }
            }
        }
    }

    updateChainEffects(dt: number) {
        this.chainEffects = this.chainEffects.filter(e => {
            e.timer -= dt;
            return e.timer > 0;
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
        this.world.spawnEnemy(type, startPos.x, startPos.y, this.state.wave, scale);
    }

    chainLightning(startEnemyIndex: number, damage: number, maxChains: number) {
        const enemies = this.world.enemies;
        let lastIdx = startEnemyIndex;

        this.chainHitSet.clear();
        this.chainHitSet.add(enemies.id[lastIdx]);

        const chainRange = 4 * CELL_SIZE;

        for (let i = 0; i < maxChains; i++) {
            let nearest = -1;
            let nearestDistSq = chainRange * chainRange;

            const nearbyEnemies = this.world.getEnemiesNear(enemies.x[lastIdx], enemies.y[lastIdx]);
            for (const ei of nearbyEnemies) {
                if (this.chainHitSet.has(enemies.id[ei])) continue;

                const dx = enemies.x[ei] - enemies.x[lastIdx];
                const dy = enemies.y[ei] - enemies.y[lastIdx];
                const distSq = dx * dx + dy * dy;

                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearest = ei;
                }
            }

            if (nearest < 0) break;

            this.chainHitSet.add(enemies.id[nearest]);

            this.chainEffects.push({
                from: { x: enemies.x[lastIdx], y: enemies.y[lastIdx] },
                to: { x: enemies.x[nearest], y: enemies.y[nearest] },
                timer: 0.1,
            });

            this.world.damageEnemy(nearest, damage);
            lastIdx = nearest;
        }
    }

    createOrExpandPuddle(x: number, y: number, emitterDef: any) {
        let expanded = false;

        const nearbyPuddles = this.puddleSpatialHash.getNearby(x, y);
        for (const puddle of nearbyPuddles) {
            const dx = puddle.data_.x - x;
            const dy = puddle.data_.y - y;
            if (dx * dx + dy * dy < 400) {
                puddle.expand(0.5, emitterDef.puddleDuration, 2, 40);
                this.puddleSpatialHash.update(puddle);
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
            this.puddleSpatialHash.insert(puddle);
        }
    }

    // ========== Game Actions ==========

    startWave() {
        if (this.state.gameOver) return;

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
            this.world.enemies.count === 0 &&
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
        emitter.redraw();

        return true;
    }

    deleteEmitter(emitter: Emitter): void {
        this.occupiedCells.delete(`${emitter.data_.gridX},${emitter.data_.gridY}`);
        this.emitters = this.emitters.filter(e => e !== emitter);
        this.emitterLayer.removeChild(emitter);

        const def = EMITTER_DEFS[emitter.data_.type];
        const refund = Math.floor(def.cost * 0.5);
        this.state.gold += refund;

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
}
