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
import { GameSettings, DEFAULT_SETTINGS, DIFFICULTY_PRESETS, saveSettings, loadSettings } from './ui/SettingsMenu';

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

    // Help overlay
    helpOverlay: Container | null = null;
    helpOverlayVisible: boolean = false;

    // Settings menu
    settingsMenu: Container | null = null;
    settingsMenuVisible: boolean = false;

    // Turret inspection panel
    inspectPanel: Container | null = null;
    rangeGraphics: Graphics;

    // Settings state
    settings: GameSettings = { ...DEFAULT_SETTINGS };

    // Debug displays
    fpsText: Text | null = null;
    entityText: Text | null = null;

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

        // Range graphics for turret inspection
        this.rangeGraphics = new Graphics();
        this.effectLayer.addChild(this.rangeGraphics);

        // Draw static grid
        this.drawGrid();

        // Create UI
        this.createUI();

        // Set up input
        this.setupInput();

        // Load settings from localStorage
        this.settings = loadSettings();
        this.autoWaveEnabled = this.settings.autoWaveEnabled;
        this.autoWaveTimer = this.settings.autoWaveDelay;
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

        // Settings (gear) button - positioned before the WAVE button
        const settingsBtn = new Container();
        settingsBtn.position.set(CANVAS_WIDTH - 175, 8);

        const settingsBtnBg = new Graphics();
        settingsBtnBg.roundRect(0, 0, 34, 34, 6).fill(0x444455);
        settingsBtn.addChild(settingsBtnBg);

        // Draw gear icon
        const gearIcon = new Graphics();
        const gearCx = 17;
        const gearCy = 17;
        const outerR = 10;
        const innerR = 5;
        const teeth = 6;

        // Outer gear shape
        gearIcon.circle(gearCx, gearCy, outerR).fill(0xaaaaaa);
        // Center hole
        gearIcon.circle(gearCx, gearCy, innerR).fill(0x444455);
        // Gear teeth
        for (let i = 0; i < teeth; i++) {
            const angle = (i / teeth) * Math.PI * 2;
            const tx = gearCx + Math.cos(angle) * 12;
            const ty = gearCy + Math.sin(angle) * 12;
            gearIcon.circle(tx, ty, 3).fill(0xaaaaaa);
        }
        settingsBtn.addChild(gearIcon);

        settingsBtn.eventMode = 'static';
        settingsBtn.cursor = 'pointer';
        settingsBtn.hitArea = new Rectangle(0, 0, 34, 34);
        settingsBtn.on('pointertap', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.toggleSettingsMenu();
        });
        settingsBtn.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
        this.uiLayer.addChild(settingsBtn);

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

        // Update debug displays
        if (this.fpsText && this.settings.showFPS) {
            this.fpsText.text = `FPS: ${Math.round(this.app.ticker.FPS)}`;
        }
        if (this.entityText && this.settings.showEntityCount) {
            this.entityText.text = `E:${this.world.enemies.count} P:${this.world.projectiles.count} T:${this.emitters.length}`;
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

        // Right-click to deselect
        this.app.stage.on('rightclick', (e: FederatedPointerEvent) => {
            e.preventDefault();
            this.state.selectedEmitterType = null;
            this.selectEmitter(null);
            this.deleteMode = false;
        });

        // Prevent context menu on canvas
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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
        // Ignore keyboard input when settings menu is open
        if (this.settingsMenuVisible) return;

        if (e.key === '1') this.setSelectedEmitterType('water');
        if (e.key === '2') this.setSelectedEmitterType('fire');
        if (e.key === '3') this.setSelectedEmitterType('electric');
        if (e.key === '4') this.setSelectedEmitterType('goo');

        // Enhanced Escape key: cycles through deselect turret type -> deselect placed turret -> exit delete mode
        if (e.key === 'Escape') {
            if (this.state.selectedEmitterType) {
                this.state.selectedEmitterType = null;
            } else if (this.state.selectedEmitterId) {
                this.selectEmitter(null);
            } else if (this.deleteMode) {
                this.deleteMode = false;
            }
        }

        // Toggle help overlay with ? or H
        if (e.key === '?' || e.key === 'h' || e.key === 'H') {
            this.toggleHelpOverlay();
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

        // Apply spawn rate multiplier (higher = faster spawns = shorter delays)
        const spawnRateMultiplier = this.settings.spawnRateMultiplier;

        for (const entry of waveDef.enemies) {
            for (let i = 0; i < entry.count; i++) {
                this.state.spawnQueue.push({
                    type: entry.type,
                    spawnAt: now + totalDelay,
                });
                // Divide delay by multiplier: 2x multiplier = half the delay = faster spawns
                totalDelay += entry.delay / spawnRateMultiplier;
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
        emitter.data_.totalInvestment += cost;  // Track investment for sell value
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
        // Clear previous inspection panel
        if (this.inspectPanel) {
            this.uiLayer.removeChild(this.inspectPanel);
            this.inspectPanel.destroy({ children: true });
            this.inspectPanel = null;
        }
        this.rangeGraphics.clear();

        for (const emitter of this.emitters) {
            emitter.setSelected(emitter.data_.id === id);
        }
        this.state.selectedEmitterId = id;

        // Show inspection panel if turret selected and no tower type selected
        if (id !== null && !this.state.selectedEmitterType) {
            const emitter = this.emitters.find(e => e.data_.id === id);
            if (emitter) {
                this.inspectPanel = this.buildInspectPanel(emitter);
                this.uiLayer.addChild(this.inspectPanel);
                this.drawRangeRing(emitter);
            }
        }
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
            this.selectEmitter(null);  // This will also clear inspect panel
        }

        // Clear inspection panel when entering placement mode
        if (this.inspectPanel) {
            this.uiLayer.removeChild(this.inspectPanel);
            this.inspectPanel.destroy({ children: true });
            this.inspectPanel = null;
        }
        this.rangeGraphics.clear();
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

    // ========== Help Overlay ==========

    toggleHelpOverlay() {
        if (this.helpOverlayVisible) {
            this.hideHelpOverlay();
        } else {
            this.showHelpOverlay();
        }
    }

    showHelpOverlay() {
        if (this.helpOverlay) return;

        this.helpOverlayVisible = true;
        this.helpOverlay = new Container();

        // Semi-transparent background
        const bg = new Graphics();
        bg.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            .fill({ color: 0x000000, alpha: 0.85 });
        bg.eventMode = 'static';
        bg.on('pointerdown', () => this.hideHelpOverlay());
        this.helpOverlay.addChild(bg);

        // Panel
        const panelWidth = 280;
        const panelHeight = 320;
        const panelX = (CANVAS_WIDTH - panelWidth) / 2;
        const panelY = (CANVAS_HEIGHT - panelHeight) / 2;

        const panel = new Graphics();
        panel.roundRect(panelX, panelY, panelWidth, panelHeight, 12)
            .fill({ color: 0x1a1a2e, alpha: 0.98 })
            .stroke({ color: 0x4488ff, width: 2 });
        this.helpOverlay.addChild(panel);

        // Title
        const title = new Text({
            text: 'Keyboard Shortcuts',
            style: { fontFamily: 'monospace', fontSize: 18, fill: '#ffffff', fontWeight: 'bold' }
        });
        title.anchor.set(0.5, 0);
        title.position.set(CANVAS_WIDTH / 2, panelY + 15);
        this.helpOverlay.addChild(title);

        // Shortcuts list
        const shortcuts = [
            ['1-4', 'Select tower type'],
            ['Space/Enter', 'Start next wave'],
            ['P', 'Toggle auto-wave pause'],
            ['Escape', 'Deselect/cancel'],
            ['Right-click', 'Deselect all'],
            ['Scroll wheel', 'Upgrade hovered turret'],
            ['? or H', 'Toggle this help'],
        ];

        let yOffset = panelY + 55;
        for (const [key, action] of shortcuts) {
            const keyBg = new Graphics();
            keyBg.roundRect(panelX + 15, yOffset, 80, 26, 4)
                .fill(0x333355);
            this.helpOverlay.addChild(keyBg);

            const keyText = new Text({
                text: key,
                style: { fontFamily: 'monospace', fontSize: 12, fill: '#ffcc00', fontWeight: 'bold' }
            });
            keyText.anchor.set(0.5, 0.5);
            keyText.position.set(panelX + 55, yOffset + 13);
            this.helpOverlay.addChild(keyText);

            const actionText = new Text({
                text: action,
                style: { fontFamily: 'monospace', fontSize: 12, fill: '#cccccc' }
            });
            actionText.position.set(panelX + 105, yOffset + 5);
            this.helpOverlay.addChild(actionText);

            yOffset += 34;
        }

        // Close button
        const closeBtn = new Container();
        closeBtn.position.set(panelX + panelWidth - 30, panelY + 8);
        const closeBg = new Graphics();
        closeBg.circle(0, 0, 12).fill(0x663333);
        closeBtn.addChild(closeBg);
        const closeX = new Text({
            text: 'X',
            style: { fontFamily: 'monospace', fontSize: 14, fill: '#ff6666', fontWeight: 'bold' }
        });
        closeX.anchor.set(0.5);
        closeBtn.addChild(closeX);
        closeBtn.eventMode = 'static';
        closeBtn.cursor = 'pointer';
        closeBtn.hitArea = new Rectangle(-12, -12, 24, 24);
        closeBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.hideHelpOverlay();
        });
        this.helpOverlay.addChild(closeBtn);

        this.uiLayer.addChild(this.helpOverlay);
    }

    hideHelpOverlay() {
        if (this.helpOverlay) {
            this.uiLayer.removeChild(this.helpOverlay);
            this.helpOverlay.destroy({ children: true });
            this.helpOverlay = null;
        }
        this.helpOverlayVisible = false;
    }

    // ========== Settings Menu ==========

    toggleSettingsMenu() {
        if (this.settingsMenuVisible) {
            this.hideSettingsMenu();
        } else {
            this.showSettingsMenu();
        }
    }

    showSettingsMenu() {
        if (this.settingsMenu) return;

        this.settingsMenuVisible = true;
        this.settingsMenu = new Container();

        // Semi-transparent background
        const bg = new Graphics();
        bg.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            .fill({ color: 0x000000, alpha: 0.85 });
        bg.eventMode = 'static';
        bg.on('pointerdown', () => this.hideSettingsMenu());
        this.settingsMenu.addChild(bg);

        // Panel
        const panelWidth = 320;
        const panelHeight = 420;
        const panelX = (CANVAS_WIDTH - panelWidth) / 2;
        const panelY = (CANVAS_HEIGHT - panelHeight) / 2;

        const panel = new Graphics();
        panel.roundRect(panelX, panelY, panelWidth, panelHeight, 12)
            .fill({ color: 0x1a1a2e, alpha: 0.98 })
            .stroke({ color: 0x44aa44, width: 2 });
        panel.eventMode = 'static';
        panel.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
        this.settingsMenu.addChild(panel);

        // Title
        const title = new Text({
            text: 'Settings',
            style: { fontFamily: 'monospace', fontSize: 20, fill: '#ffffff', fontWeight: 'bold' }
        });
        title.anchor.set(0.5, 0);
        title.position.set(CANVAS_WIDTH / 2, panelY + 15);
        this.settingsMenu.addChild(title);

        let yOffset = panelY + 55;
        const labelStyle = { fontFamily: 'monospace', fontSize: 13, fill: '#cccccc' };
        const valueStyle = { fontFamily: 'monospace', fontSize: 13, fill: '#ffcc00' };

        // Spawn Rate Slider
        this.addSettingsRow('Spawn Rate:', `${this.settings.spawnRateMultiplier.toFixed(1)}x`, panelX, yOffset);
        this.addSlider(panelX + 180, yOffset, 120, this.settings.spawnRateMultiplier, 0.5, 2.0, (val) => {
            this.settings.spawnRateMultiplier = Math.round(val * 10) / 10;
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        // Auto-Wave Toggle
        this.addSettingsRow('Auto-Wave:', this.settings.autoWaveEnabled ? 'ON' : 'OFF', panelX, yOffset);
        this.addToggle(panelX + 250, yOffset, this.settings.autoWaveEnabled, (val) => {
            this.settings.autoWaveEnabled = val;
            this.autoWaveEnabled = val;
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        // Auto-Wave Delay Slider
        this.addSettingsRow('Wave Delay:', `${(this.settings.autoWaveDelay / 1000).toFixed(1)}s`, panelX, yOffset);
        this.addSlider(panelX + 180, yOffset, 120, this.settings.autoWaveDelay, 1000, 5000, (val) => {
            this.settings.autoWaveDelay = Math.round(val / 100) * 100;
            this.autoWaveTimer = this.settings.autoWaveDelay;
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        // FPS Counter Toggle
        this.addSettingsRow('FPS Counter:', this.settings.showFPS ? 'ON' : 'OFF', panelX, yOffset);
        this.addToggle(panelX + 250, yOffset, this.settings.showFPS, (val) => {
            this.settings.showFPS = val;
            this.updateDebugDisplays();
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        // Entity Count Toggle
        this.addSettingsRow('Entity Count:', this.settings.showEntityCount ? 'ON' : 'OFF', panelX, yOffset);
        this.addToggle(panelX + 250, yOffset, this.settings.showEntityCount, (val) => {
            this.settings.showEntityCount = val;
            this.updateDebugDisplays();
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        // Difficulty Dropdown
        this.addSettingsRow('Difficulty:', this.settings.difficulty.toUpperCase(), panelX, yOffset);
        this.addDifficultyButtons(panelX + 20, yOffset + 25, (diff) => {
            this.settings.difficulty = diff;
            this.refreshSettingsMenu();
        });
        yOffset += 75;

        // Sound/Music Toggles (future-proofing)
        this.addSettingsRow('Sound:', this.settings.soundEnabled ? 'ON' : 'OFF', panelX, yOffset);
        this.addToggle(panelX + 250, yOffset, this.settings.soundEnabled, (val) => {
            this.settings.soundEnabled = val;
            this.refreshSettingsMenu();
        });
        yOffset += 40;

        this.addSettingsRow('Music:', this.settings.musicEnabled ? 'ON' : 'OFF', panelX, yOffset);
        this.addToggle(panelX + 250, yOffset, this.settings.musicEnabled, (val) => {
            this.settings.musicEnabled = val;
            this.refreshSettingsMenu();
        });
        yOffset += 50;

        // Reset Game Button
        const resetBtn = new Container();
        resetBtn.position.set(panelX + panelWidth / 2, yOffset);
        const resetBg = new Graphics();
        resetBg.roundRect(-60, -15, 120, 30, 6).fill(0x663333);
        resetBtn.addChild(resetBg);
        const resetText = new Text({
            text: 'Reset Game',
            style: { fontFamily: 'monospace', fontSize: 14, fill: '#ff6666', fontWeight: 'bold' }
        });
        resetText.anchor.set(0.5);
        resetBtn.addChild(resetText);
        resetBtn.eventMode = 'static';
        resetBtn.cursor = 'pointer';
        resetBtn.hitArea = new Rectangle(-60, -15, 120, 30);
        resetBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            saveSettings(this.settings);
            window.location.reload();
        });
        this.settingsMenu.addChild(resetBtn);

        // Close button
        const closeBtn = new Container();
        closeBtn.position.set(panelX + panelWidth - 30, panelY + 8);
        const closeBg = new Graphics();
        closeBg.circle(0, 0, 12).fill(0x336633);
        closeBtn.addChild(closeBg);
        const closeX = new Text({
            text: 'X',
            style: { fontFamily: 'monospace', fontSize: 14, fill: '#66ff66', fontWeight: 'bold' }
        });
        closeX.anchor.set(0.5);
        closeBtn.addChild(closeX);
        closeBtn.eventMode = 'static';
        closeBtn.cursor = 'pointer';
        closeBtn.hitArea = new Rectangle(-12, -12, 24, 24);
        closeBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.hideSettingsMenu();
        });
        this.settingsMenu.addChild(closeBtn);

        this.uiLayer.addChild(this.settingsMenu);
    }

    private addSettingsRow(label: string, value: string, panelX: number, y: number) {
        const labelText = new Text({
            text: label,
            style: { fontFamily: 'monospace', fontSize: 13, fill: '#cccccc' }
        });
        labelText.position.set(panelX + 20, y);
        this.settingsMenu!.addChild(labelText);

        const valueText = new Text({
            text: value,
            style: { fontFamily: 'monospace', fontSize: 13, fill: '#ffcc00' }
        });
        valueText.position.set(panelX + 130, y);
        this.settingsMenu!.addChild(valueText);
    }

    private addSlider(x: number, y: number, width: number, value: number, min: number, max: number, onChange: (val: number) => void) {
        const track = new Graphics();
        track.roundRect(x, y + 5, width, 10, 5).fill(0x333355);
        this.settingsMenu!.addChild(track);

        const fillWidth = ((value - min) / (max - min)) * width;
        const fill = new Graphics();
        fill.roundRect(x, y + 5, fillWidth, 10, 5).fill(0x4488ff);
        this.settingsMenu!.addChild(fill);

        const handle = new Graphics();
        const handleX = x + fillWidth;
        handle.circle(handleX, y + 10, 8).fill(0xffffff);
        this.settingsMenu!.addChild(handle);

        // Make track interactive
        track.eventMode = 'static';
        track.cursor = 'pointer';
        track.hitArea = new Rectangle(x, y, width, 20);
        track.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            const localX = e.globalX / ((this.app as any).gameScale || 1) - x;
            const newVal = min + (localX / width) * (max - min);
            onChange(Math.max(min, Math.min(max, newVal)));
        });
    }

    private addToggle(x: number, y: number, value: boolean, onChange: (val: boolean) => void) {
        const toggle = new Container();
        toggle.position.set(x, y);

        const bg = new Graphics();
        bg.roundRect(0, 0, 50, 24, 12).fill(value ? 0x44aa44 : 0x444466);
        toggle.addChild(bg);

        const handle = new Graphics();
        handle.circle(value ? 38 : 12, 12, 10).fill(0xffffff);
        toggle.addChild(handle);

        toggle.eventMode = 'static';
        toggle.cursor = 'pointer';
        toggle.hitArea = new Rectangle(0, 0, 50, 24);
        toggle.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            onChange(!value);
        });

        this.settingsMenu!.addChild(toggle);
    }

    private addDifficultyButtons(x: number, y: number, onChange: (diff: 'easy' | 'normal' | 'hard') => void) {
        const difficulties: Array<'easy' | 'normal' | 'hard'> = ['easy', 'normal', 'hard'];
        const colors = { easy: 0x44aa44, normal: 0x4488ff, hard: 0xaa4444 };

        difficulties.forEach((diff, i) => {
            const btn = new Container();
            btn.position.set(x + i * 95, y);

            const isSelected = this.settings.difficulty === diff;
            const bg = new Graphics();
            bg.roundRect(0, 0, 85, 28, 6).fill(isSelected ? colors[diff] : 0x333344);
            if (isSelected) {
                bg.roundRect(0, 0, 85, 28, 6).stroke({ color: 0xffffff, width: 2 });
            }
            btn.addChild(bg);

            const text = new Text({
                text: diff.toUpperCase(),
                style: { fontFamily: 'monospace', fontSize: 12, fill: '#ffffff', fontWeight: isSelected ? 'bold' : 'normal' }
            });
            text.anchor.set(0.5);
            text.position.set(42.5, 14);
            btn.addChild(text);

            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            btn.hitArea = new Rectangle(0, 0, 85, 28);
            btn.on('pointerdown', (e: FederatedPointerEvent) => {
                e.stopPropagation();
                onChange(diff);
            });

            this.settingsMenu!.addChild(btn);
        });
    }

    private refreshSettingsMenu() {
        saveSettings(this.settings);
        if (this.settingsMenu) {
            this.uiLayer.removeChild(this.settingsMenu);
            this.settingsMenu.destroy({ children: true });
            this.settingsMenu = null;
        }
        this.showSettingsMenu();
    }

    hideSettingsMenu() {
        if (this.settingsMenu) {
            saveSettings(this.settings);
            this.uiLayer.removeChild(this.settingsMenu);
            this.settingsMenu.destroy({ children: true });
            this.settingsMenu = null;
        }
        this.settingsMenuVisible = false;
    }

    private updateDebugDisplays() {
        // Create or remove FPS display
        if (this.settings.showFPS && !this.fpsText) {
            this.fpsText = new Text({
                text: 'FPS: --',
                style: { fontFamily: 'monospace', fontSize: 12, fill: '#88ff88' }
            });
            this.fpsText.position.set(CANVAS_WIDTH - 70, 3);
            this.uiLayer.addChild(this.fpsText);
        } else if (!this.settings.showFPS && this.fpsText) {
            this.uiLayer.removeChild(this.fpsText);
            this.fpsText.destroy();
            this.fpsText = null;
        }

        // Create or remove entity count display
        if (this.settings.showEntityCount && !this.entityText) {
            this.entityText = new Text({
                text: 'E:0 P:0 T:0',
                style: { fontFamily: 'monospace', fontSize: 12, fill: '#88ff88' }
            });
            this.entityText.position.set(CANVAS_WIDTH - 140, 35);
            this.uiLayer.addChild(this.entityText);
        } else if (!this.settings.showEntityCount && this.entityText) {
            this.uiLayer.removeChild(this.entityText);
            this.entityText.destroy();
            this.entityText = null;
        }
    }

    // ========== Turret Inspection Panel ==========

    buildInspectPanel(emitter: Emitter): Container {
        const panel = new Container();
        const def = EMITTER_DEFS[emitter.data_.type];
        const mult = getUpgradeMultiplier(emitter.data_.level);

        // Background
        const bg = new Graphics();
        bg.roundRect(0, 0, 180, 240, 8)
            .fill({ color: 0x1a1a2e, alpha: 0.95 })
            .stroke({ color: def.color, width: 2 });
        bg.eventMode = 'static';
        bg.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
        panel.addChild(bg);

        // Title
        const typeName = emitter.data_.type.charAt(0).toUpperCase() + emitter.data_.type.slice(1);
        const title = new Text({
            text: `${typeName} Cannon`,
            style: { fontFamily: 'monospace', fontSize: 14, fill: '#ffffff', fontWeight: 'bold' }
        });
        title.position.set(10, 10);
        panel.addChild(title);

        const levelText = new Text({
            text: `Lv ${emitter.data_.level + 1}`,
            style: { fontFamily: 'monospace', fontSize: 12, fill: '#ffcc00' }
        });
        levelText.position.set(140, 12);
        panel.addChild(levelText);

        // Stats
        let y = 38;
        const stats = [
            ['DMG', def.damage, mult.damage],
            ['RNG', def.range, mult.range],
            ['RPS', def.fireRate, mult.fireRate],
            ['KNK', def.knockbackForce, mult.knockback],
            ['Pierce', def.particlePierce, 1],
        ];

        for (const [label, base, multiplier] of stats) {
            const effective = (base as number) * (multiplier as number);
            const statText = new Text({
                text: `${label}: ${base} x ${(multiplier as number).toFixed(2)} = ${effective.toFixed(1)}`,
                style: { fontFamily: 'monospace', fontSize: 10, fill: '#aaaaaa' }
            });
            statText.position.set(10, y);
            panel.addChild(statText);
            y += 18;
        }

        // Special effects
        y += 5;
        let specialText = '';
        if (def.dotDamage) specialText = `DOT: ${def.dotDamage}/s for ${def.dotDuration}s`;
        if (def.chainCount) specialText = `Chain: ${def.chainCount} targets`;
        if (def.slowFactor) specialText = `Slow: ${(1 - def.slowFactor) * 100}% for ${def.slowDuration}s`;
        if (def.puddleDuration) specialText += (specialText ? '\n' : '') + `Puddle: ${def.puddleDuration}s`;

        if (specialText) {
            const special = new Text({
                text: specialText,
                style: { fontFamily: 'monospace', fontSize: 10, fill: '#88ccff' }
            });
            special.position.set(10, y);
            panel.addChild(special);
            y += specialText.includes('\n') ? 30 : 18;
        }

        // Upgrade button
        y += 5;
        const upgradeCost = getUpgradeCost(emitter.data_.level);
        const canAfford = this.state.gold >= upgradeCost;

        const upgradeBtn = new Container();
        upgradeBtn.position.set(10, y);
        const upgradeBg = new Graphics();
        upgradeBg.roundRect(0, 0, 75, 28, 6).fill(canAfford ? 0x44aa44 : 0x333344);
        upgradeBtn.addChild(upgradeBg);
        const upgradeBtnText = new Text({
            text: `+1 $${upgradeCost}`,
            style: { fontFamily: 'monospace', fontSize: 11, fill: canAfford ? '#ffffff' : '#666666', fontWeight: 'bold' }
        });
        upgradeBtnText.anchor.set(0.5);
        upgradeBtnText.position.set(37.5, 14);
        upgradeBtn.addChild(upgradeBtnText);

        if (canAfford) {
            upgradeBtn.eventMode = 'static';
            upgradeBtn.cursor = 'pointer';
            upgradeBtn.hitArea = new Rectangle(0, 0, 75, 28);
            upgradeBtn.on('pointerdown', (e: FederatedPointerEvent) => {
                e.stopPropagation();
                this.upgradeEmitter(emitter);
                // Refresh panel
                this.selectEmitter(emitter.data_.id);
            });
        }
        panel.addChild(upgradeBtn);

        // Sell button
        const sellValue = emitter.getSellValue();
        const sellBtn = new Container();
        sellBtn.position.set(95, y);
        const sellBg = new Graphics();
        sellBg.roundRect(0, 0, 75, 28, 6).fill(0xaa4444);
        sellBtn.addChild(sellBg);
        const sellBtnText = new Text({
            text: `Sell $${sellValue}`,
            style: { fontFamily: 'monospace', fontSize: 11, fill: '#ffffff', fontWeight: 'bold' }
        });
        sellBtnText.anchor.set(0.5);
        sellBtnText.position.set(37.5, 14);
        sellBtn.addChild(sellBtnText);

        sellBtn.eventMode = 'static';
        sellBtn.cursor = 'pointer';
        sellBtn.hitArea = new Rectangle(0, 0, 75, 28);
        sellBtn.on('pointerdown', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.sellEmitter(emitter);
        });
        panel.addChild(sellBtn);

        // Position panel near turret, clamped to screen
        let panelX = emitter.x + CELL_SIZE;
        let panelY = emitter.y - 50;
        panelX = Math.min(panelX, CANVAS_WIDTH - 190);
        panelX = Math.max(10, panelX);
        panelY = Math.max(UI_TOP_HEIGHT + 10, Math.min(panelY, GAME_HEIGHT + UI_TOP_HEIGHT - 250));
        panel.position.set(panelX, panelY);

        return panel;
    }

    drawRangeRing(emitter: Emitter) {
        const def = EMITTER_DEFS[emitter.data_.type];
        const range = emitter.getRange();

        this.rangeGraphics.clear();
        this.rangeGraphics.circle(emitter.x, emitter.y, range)
            .fill({ color: def.color, alpha: 0.15 })
            .stroke({ color: def.color, alpha: 0.5, width: 2 });
    }

    sellEmitter(emitter: Emitter): void {
        const sellValue = emitter.getSellValue();
        this.occupiedCells.delete(`${emitter.data_.gridX},${emitter.data_.gridY}`);
        this.emitters = this.emitters.filter(e => e !== emitter);
        this.emitterLayer.removeChild(emitter);
        this.state.gold += sellValue;

        if (this.state.selectedEmitterId === emitter.data_.id) {
            this.selectEmitter(null);
        }
    }
}
