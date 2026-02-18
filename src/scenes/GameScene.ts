import Phaser from 'phaser';
import { Enemy } from '../objects/Enemy';
import { Projectile } from '../objects/Projectile';
import { Emitter } from '../objects/Emitter';
import { Puddle } from '../objects/Puddle';
import {
    GameState, EmitterType, EnemyType, Vec2, ParticleType
} from '../types';
import {
    GRID_SIZE, CELL_SIZE, GAME_WIDTH, GAME_HEIGHT, UI_TOP_HEIGHT,
    PATH, NEXUS_X, NEXUS_Y, getPathCells,
    EMITTER_DEFS, ENEMY_DEFS, getUpgradeMultiplier,
    STARTING_GOLD, STARTING_HEALTH, generateWave, getUpgradeCost,
    MAX_PARTICLES, AUTO_WAVE_DELAY
} from '../config';

export class GameScene extends Phaser.Scene {
    // Game state
    state!: GameState;

    // Object pools / groups
    enemies!: Phaser.GameObjects.Group;
    projectiles!: Phaser.GameObjects.Group;
    emitters!: Phaser.GameObjects.Group;
    puddles!: Phaser.GameObjects.Group;

    // Graphics
    gridGraphics!: Phaser.GameObjects.Graphics;
    nexusGraphics!: Phaser.GameObjects.Graphics;
    enemyGraphics!: Phaser.GameObjects.Graphics;
    chainGraphics!: Phaser.GameObjects.Graphics;
    hoverGraphics!: Phaser.GameObjects.Graphics;

    // Path data
    pathCells!: Set<string>;
    occupiedCells!: Set<string>;
    worldPath!: Vec2[];

    // Hover state
    hoverCell: { x: number; y: number } | null = null;

    // Chain lightning effects
    chainEffects: Array<{ from: Vec2; to: Vec2; timer: number }> = [];

    // Death explosion particles
    deathParticles: Array<{
        x: number; y: number;
        vx: number; vy: number;
        color: number;
        size: number;
        life: number;
    }> = [];

    // Nexus animation
    nexusPulse: number = 0;

    // Auto-wave timer
    autoWaveTimer: number = 0;
    autoWaveEnabled: boolean = true;

    // Game area offset (for UI)
    gameOffsetY: number = UI_TOP_HEIGHT;

    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
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

        // Initialize path data
        this.pathCells = getPathCells();
        this.occupiedCells = new Set();
        this.worldPath = PATH.map(p => this.gridToPixel(p.x, p.y));

        // Create object groups (for pooling)
        this.enemies = this.add.group({
            classType: Enemy,
            runChildUpdate: false,
            maxSize: 100,
        });

        this.projectiles = this.add.group({
            classType: Projectile,
            runChildUpdate: false,
            maxSize: MAX_PARTICLES,
        });

        this.emitters = this.add.group({
            classType: Emitter,
            runChildUpdate: false,
        });

        this.puddles = this.add.group({
            classType: Puddle,
            runChildUpdate: false,
        });

        // Create graphics layers
        this.gridGraphics = this.add.graphics();
        this.gridGraphics.setDepth(0);

        this.nexusGraphics = this.add.graphics();
        this.nexusGraphics.setDepth(2);

        this.enemyGraphics = this.add.graphics();
        this.enemyGraphics.setDepth(15);

        this.chainGraphics = this.add.graphics();
        this.chainGraphics.setDepth(20);

        this.hoverGraphics = this.add.graphics();
        this.hoverGraphics.setDepth(25);

        // Draw static grid
        this.drawGrid();

        // Set up input
        this.input.on('pointermove', this.onPointerMove, this);
        this.input.on('pointerdown', this.onPointerDown, this);

        // Keyboard shortcuts
        this.input.keyboard?.on('keydown', this.onKeyDown, this);

        // Launch UI scene
        this.scene.launch('UIScene', { gameScene: this });

        // Start first wave automatically after a short delay
        this.autoWaveTimer = AUTO_WAVE_DELAY;
    }

    update(time: number, delta: number) {
        if (this.state.gameOver || this.state.paused) return;

        const dt = delta / 1000;
        const now = performance.now();

        // Process spawn queue
        this.processSpawnQueue(now);

        // Update all game objects
        this.updateEnemies(dt);
        this.updateEmitters(dt);
        this.updateProjectiles(dt);
        this.updatePuddles(dt);
        this.updateChainEffects(dt);

        // Update death particles
        this.updateDeathParticles(dt);

        // Draw dynamic elements
        this.drawNexus();
        this.drawEnemies();
        this.drawChainEffects();
        this.drawDeathParticles();
        this.drawHoverCell();

        // Check wave completion
        this.checkWaveCompletion();

        // Check game over
        if (this.state.health <= 0) {
            this.state.gameOver = true;
            this.events.emit('gameOver', this.state.wave);
        }

        // Auto-wave system
        if (this.autoWaveEnabled && !this.state.waveActive) {
            this.autoWaveTimer -= delta;
            if (this.autoWaveTimer <= 0) {
                this.startWave();
                this.autoWaveTimer = AUTO_WAVE_DELAY;
            }
        }
    }

    // ========== Grid Helpers ==========

    gridToPixel(gx: number, gy: number): Vec2 {
        return {
            x: gx * CELL_SIZE + CELL_SIZE / 2,
            y: gy * CELL_SIZE + CELL_SIZE / 2 + this.gameOffsetY,
        };
    }

    pixelToGrid(px: number, py: number): { x: number; y: number } | null {
        const gx = Math.floor(px / CELL_SIZE);
        const gy = Math.floor((py - this.gameOffsetY) / CELL_SIZE);
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

                // Checkerboard pattern
                let color: number;
                if (isPath) {
                    color = 0x3d3328;
                } else {
                    color = ((x + y) % 2 === 0) ? 0x2a3a2a : 0x253525;
                }

                g.fillStyle(color, 1);
                g.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1 + this.gameOffsetY, CELL_SIZE - 2, CELL_SIZE - 2);
            }
        }
    }

    drawNexus() {
        const g = this.nexusGraphics;
        g.clear();

        const cx = NEXUS_X * CELL_SIZE + CELL_SIZE / 2;
        const cy = NEXUS_Y * CELL_SIZE + CELL_SIZE / 2 + this.gameOffsetY;

        this.nexusPulse += 0.05;
        const pulse = 0.7 + Math.sin(this.nexusPulse) * 0.3;
        const glowRadius = CELL_SIZE * 0.8 * pulse;

        // Outer glow (simplified for performance)
        g.fillStyle(0x2244aa, pulse * 0.3);
        g.fillCircle(cx, cy, glowRadius);

        // Core
        g.fillStyle(0x4488ff, 1);
        g.fillCircle(cx, cy, CELL_SIZE * 0.4);

        // Inner shine
        g.fillStyle(0x88bbff, 1);
        g.fillCircle(cx - 3, cy - 3, CELL_SIZE * 0.15);
    }

    drawEnemies() {
        const g = this.enemyGraphics;
        g.clear();

        this.enemies.getChildren().forEach((child) => {
            const enemy = child as Enemy;
            if (!enemy.active) return;

            const def = ENEMY_DEFS[enemy.data_.type];
            const body = enemy.body as Phaser.Physics.Arcade.Body;
            const x = enemy.x;
            const y = enemy.y;
            const s = def.size;

            // Flash effect
            let color = def.color;
            if (enemy.data_.flashTimer > 0) {
                color = 0xffffff;
            }

            // Darker shade for outlines
            const dark = this.darkenColor(color, 0.5);

            // DOT fire effect - pixel flames
            if (enemy.data_.dotTimer > 0) {
                for (let i = 0; i < 4; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = s * 0.6 + Math.random() * 4;
                    const fx = x + Math.cos(angle) * dist;
                    const fy = y + Math.sin(angle) * dist;
                    // Pixel fire
                    g.fillStyle(0xff6600, 0.9);
                    g.fillRect(fx - 2, fy - 3, 4, 6);
                    g.fillStyle(0xffaa00, 0.8);
                    g.fillRect(fx - 1, fy - 5, 2, 4);
                }
            }

            // Draw pixelated enemy based on type
            const type = enemy.data_.type;

            if (type === 'grunt') {
                // Angry square with spikes
                g.fillStyle(color, 1);
                g.fillRect(x - s, y - s, s * 2, s * 2);
                // Corner spikes
                g.fillStyle(dark, 1);
                g.fillRect(x - s - 3, y - s - 3, 4, 4);
                g.fillRect(x + s - 1, y - s - 3, 4, 4);
                g.fillRect(x - s - 3, y + s - 1, 4, 4);
                g.fillRect(x + s - 1, y + s - 1, 4, 4);
                // Angry eyes
                g.fillStyle(0x000000, 1);
                g.fillRect(x - s * 0.5, y - s * 0.3, 3, 4);
                g.fillRect(x + s * 0.2, y - s * 0.3, 3, 4);
                // Angry mouth
                g.fillRect(x - s * 0.4, y + s * 0.3, s * 0.8, 2);
            } else if (type === 'fast') {
                // Diamond/arrow shape
                g.fillStyle(color, 1);
                g.beginPath();
                g.moveTo(x, y - s);
                g.lineTo(x + s, y);
                g.lineTo(x, y + s * 0.7);
                g.lineTo(x - s, y);
                g.closePath();
                g.fillPath();
                // Speed lines
                g.fillStyle(dark, 0.6);
                g.fillRect(x - s - 6, y - 1, 4, 2);
                g.fillRect(x - s - 10, y + 3, 3, 2);
                // Eye
                g.fillStyle(0x000000, 1);
                g.fillRect(x - 2, y - s * 0.3, 4, 3);
            } else if (type === 'tank') {
                // Big chunky square with armor plates
                g.fillStyle(dark, 1);
                g.fillRect(x - s - 2, y - s - 2, s * 2 + 4, s * 2 + 4);
                g.fillStyle(color, 1);
                g.fillRect(x - s, y - s, s * 2, s * 2);
                // Armor plates
                g.fillStyle(this.lightenColor(color, 0.3), 1);
                g.fillRect(x - s + 2, y - s + 2, s - 2, s - 2);
                // Visor
                g.fillStyle(0x222222, 1);
                g.fillRect(x - s * 0.6, y - s * 0.2, s * 1.2, 4);
                g.fillStyle(0x44ffff, 0.8);
                g.fillRect(x - s * 0.5, y - s * 0.1, s, 2);
            } else if (type === 'shielded') {
                // Hexagon-ish shape
                g.fillStyle(color, 1);
                g.beginPath();
                g.moveTo(x - s * 0.5, y - s);
                g.lineTo(x + s * 0.5, y - s);
                g.lineTo(x + s, y);
                g.lineTo(x + s * 0.5, y + s);
                g.lineTo(x - s * 0.5, y + s);
                g.lineTo(x - s, y);
                g.closePath();
                g.fillPath();
                // Shield shimmer
                g.fillStyle(0xffffff, 0.3);
                g.fillRect(x - s * 0.3, y - s * 0.8, 3, s * 0.6);
                // Eyes
                g.fillStyle(0x000000, 1);
                g.fillRect(x - 4, y - 2, 3, 3);
                g.fillRect(x + 1, y - 2, 3, 3);
            } else if (type === 'splitter') {
                // Two connected blobs
                g.fillStyle(color, 1);
                g.fillRect(x - s, y - s * 0.7, s * 0.9, s * 1.4);
                g.fillRect(x + s * 0.1, y - s * 0.7, s * 0.9, s * 1.4);
                // Connection
                g.fillStyle(dark, 1);
                g.fillRect(x - 2, y - s * 0.3, 4, s * 0.6);
                // Four eyes
                g.fillStyle(0x000000, 1);
                g.fillRect(x - s * 0.7, y - s * 0.2, 2, 2);
                g.fillRect(x - s * 0.4, y - s * 0.2, 2, 2);
                g.fillRect(x + s * 0.3, y - s * 0.2, 2, 2);
                g.fillRect(x + s * 0.6, y - s * 0.2, 2, 2);
            } else if (type === 'boss') {
                // Big scary boss - skull-like
                g.fillStyle(dark, 1);
                g.fillRect(x - s - 3, y - s - 3, s * 2 + 6, s * 2 + 6);
                g.fillStyle(color, 1);
                g.fillRect(x - s, y - s, s * 2, s * 2);
                // Skull features
                g.fillStyle(0x000000, 1);
                // Eye sockets
                g.fillRect(x - s * 0.6, y - s * 0.5, s * 0.5, s * 0.6);
                g.fillRect(x + s * 0.1, y - s * 0.5, s * 0.5, s * 0.6);
                // Glowing eyes
                g.fillStyle(0xff0000, 1);
                g.fillRect(x - s * 0.5, y - s * 0.3, s * 0.3, s * 0.3);
                g.fillRect(x + s * 0.2, y - s * 0.3, s * 0.3, s * 0.3);
                // Teeth
                g.fillStyle(0xffffff, 1);
                for (let i = 0; i < 4; i++) {
                    g.fillRect(x - s * 0.6 + i * s * 0.35, y + s * 0.3, s * 0.25, s * 0.4);
                }
            } else if (type === 'healer') {
                // Healer - circular with cross/plus sign
                g.fillStyle(color, 1);
                g.fillCircle(x, y, s);
                // Cross symbol
                g.fillStyle(0xffffff, 1);
                g.fillRect(x - 2, y - s * 0.6, 4, s * 1.2); // vertical
                g.fillRect(x - s * 0.6, y - 2, s * 1.2, 4); // horizontal
                // Healing aura (pulsing)
                const healPulse = 0.3 + Math.sin(performance.now() * 0.005) * 0.2;
                g.fillStyle(0x44ff88, healPulse);
                g.fillCircle(x, y, s + 8);
            } else if (type === 'cloaked') {
                // Cloaked enemy - semi-transparent, ghostly
                const cloakAlpha = 0.35 + Math.sin(performance.now() * 0.003) * 0.15;
                g.fillStyle(color, cloakAlpha);
                // Diamond/stealth shape
                g.beginPath();
                g.moveTo(x, y - s);
                g.lineTo(x + s * 0.8, y);
                g.lineTo(x, y + s);
                g.lineTo(x - s * 0.8, y);
                g.closePath();
                g.fillPath();
                // Ghost eyes
                g.fillStyle(0xffffff, cloakAlpha + 0.3);
                g.fillRect(x - 4, y - 2, 3, 3);
                g.fillRect(x + 1, y - 2, 3, 3);
            } else {
                // Fallback - simple square
                g.fillStyle(color, 1);
                g.fillRect(x - s, y - s, s * 2, s * 2);
            }
        });
    }

    darkenColor(color: number, factor: number): number {
        const r = Math.floor(((color >> 16) & 255) * factor);
        const g = Math.floor(((color >> 8) & 255) * factor);
        const b = Math.floor((color & 255) * factor);
        return (r << 16) | (g << 8) | b;
    }

    lightenColor(color: number, factor: number): number {
        const r = Math.min(255, Math.floor(((color >> 16) & 255) * (1 + factor)));
        const g = Math.min(255, Math.floor(((color >> 8) & 255) * (1 + factor)));
        const b = Math.min(255, Math.floor((color & 255) * (1 + factor)));
        return (r << 16) | (g << 8) | b;
    }

    drawChainEffects() {
        const g = this.chainGraphics;
        g.clear();

        for (const effect of this.chainEffects) {
            const segments = 5;
            const jitter = 8;

            // Outer glow
            g.lineStyle(4, 0xffff44, 0.5);
            g.beginPath();
            g.moveTo(effect.from.x, effect.from.y);
            for (let i = 1; i < segments; i++) {
                const t = i / segments;
                const x = effect.from.x + (effect.to.x - effect.from.x) * t + (Math.random() - 0.5) * jitter;
                const y = effect.from.y + (effect.to.y - effect.from.y) * t + (Math.random() - 0.5) * jitter;
                g.lineTo(x, y);
            }
            g.lineTo(effect.to.x, effect.to.y);
            g.strokePath();

            // Inner bright line
            g.lineStyle(2, 0xffffff, 0.9);
            g.strokePath();
        }
    }

    drawHoverCell() {
        const g = this.hoverGraphics;
        g.clear();

        if (this.hoverCell && this.state.selectedEmitterType) {
            const valid = this.canPlaceEmitter(this.hoverCell.x, this.hoverCell.y);
            const def = EMITTER_DEFS[this.state.selectedEmitterType];
            const canAfford = this.state.gold >= def.cost;

            const cellX = this.hoverCell.x * CELL_SIZE;
            const cellY = this.hoverCell.y * CELL_SIZE + this.gameOffsetY;
            const centerX = cellX + CELL_SIZE / 2;
            const centerY = cellY + CELL_SIZE / 2;

            // Cell highlight
            const validColor = canAfford ? 0x00ff00 : 0xffaa00;
            g.fillStyle(valid ? validColor : 0xff0000, 0.2);
            g.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);

            g.lineStyle(2, valid ? validColor : 0xff0000, 0.8);
            g.strokeRect(cellX + 1, cellY + 1, CELL_SIZE - 2, CELL_SIZE - 2);

            // Ghost tower preview (only if valid placement)
            if (valid) {
                const ghostAlpha = canAfford ? 0.5 : 0.3;
                const size = CELL_SIZE * 0.7;

                // Ghost base
                g.fillStyle(def.color, ghostAlpha);
                g.fillRect(centerX - size / 2, centerY - size / 2, size, size);

                // Ghost barrel (pointing right)
                const darkColor = this.darkenColor(def.color, 0.7);
                g.fillStyle(darkColor, ghostAlpha);
                g.fillRect(centerX, centerY - 4, size * 0.4, 8);

                // Range preview circle
                const range = def.range * CELL_SIZE;
                g.lineStyle(1, def.color, ghostAlpha * 0.6);
                g.strokeCircle(centerX, centerY, range);
                g.fillStyle(def.color, ghostAlpha * 0.1);
                g.fillCircle(centerX, centerY, range);
            }
        }
    }

    // ========== Updates ==========

    processSpawnQueue(now: number) {
        const toSpawn = this.state.spawnQueue.filter(s => now >= s.spawnAt);
        for (const s of toSpawn) {
            this.spawnEnemy(s.type);
        }
        this.state.spawnQueue = this.state.spawnQueue.filter(s => now < s.spawnAt);
    }

    updateEnemies(dt: number) {
        const toRemove: Enemy[] = [];

        // First pass: healer enemies heal nearby allies
        this.enemies.getChildren().forEach((child) => {
            const healer = child as Enemy;
            if (!healer.active || healer.data_.type !== 'healer') return;

            const healerDef = ENEMY_DEFS[healer.data_.type];
            const healRadius = healerDef.healRadius || 0;
            const healAmount = healerDef.healAmount || 0;

            if (healRadius > 0 && healAmount > 0) {
                this.enemies.getChildren().forEach((otherChild) => {
                    const other = otherChild as Enemy;
                    if (!other.active || other === healer) return;

                    const dx = other.x - healer.x;
                    const dy = other.y - healer.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist <= healRadius) {
                        // Heal the ally
                        other.data_.health = Math.min(
                            other.data_.maxHealth,
                            other.data_.health + healAmount * dt
                        );
                    }
                });
            }
        });

        // Second pass: normal enemy updates
        this.enemies.getChildren().forEach((child) => {
            const enemy = child as Enemy;
            if (!enemy.active) return;

            // Check puddle slow effects
            this.puddles.getChildren().forEach((puddleChild) => {
                const puddle = puddleChild as Puddle;
                if (puddle.active && puddle.containsPoint(enemy.x, enemy.y)) {
                    enemy.data_.slowFactor = Math.min(
                        enemy.data_.slowFactor,
                        puddle.data_.slowFactor
                    );
                }
            });

            const alive = enemy.updateEnemy(dt);

            if (!alive) {
                if (enemy.reachedEnd()) {
                    // Damage player
                    this.state.health -= 1;
                    this.events.emit('healthChanged', this.state.health);
                    // Screen shake on damage!
                    this.cameras.main.shake(200, 0.01);
                } else if (enemy.data_.health <= 0) {
                    // Killed - give reward
                    this.state.gold += enemy.data_.reward;
                    this.events.emit('goldChanged', this.state.gold);

                    // DEATH EXPLOSION!
                    const def = ENEMY_DEFS[enemy.data_.type];
                    this.spawnDeathExplosion(enemy.x, enemy.y, def.color, def.size);

                    // Handle splitter
                    if (def.splitCount && def.splitCount > 0) {
                        for (let i = 0; i < def.splitCount; i++) {
                            const angle = (Math.PI * 2 / def.splitCount) * i;
                            const offsetX = Math.cos(angle) * 15;
                            const offsetY = Math.sin(angle) * 15;
                            this.spawnEnemy(
                                'grunt',
                                { x: enemy.x + offsetX, y: enemy.y + offsetY },
                                0.5
                            );
                        }
                    }

                    // Boss death = big shake
                    if (enemy.data_.type === 'boss') {
                        this.cameras.main.shake(400, 0.02);
                    }
                }
                toRemove.push(enemy);
            }
        });

        // Clean up dead enemies
        for (const enemy of toRemove) {
            enemy.cleanup();
            this.enemies.remove(enemy, true, true);
        }
    }

    updateEmitters(dt: number) {
        this.emitters.getChildren().forEach((child) => {
            const emitter = child as Emitter;
            emitter.updateEmitter(dt);

            if (!emitter.canFire()) return;

            const def = EMITTER_DEFS[emitter.data_.type];
            const range = emitter.getRange();
            const emitterPos = emitter.getPosition();

            // Find target
            let bestTarget: Enemy | null = null;
            let bestDist = Infinity;

            this.enemies.getChildren().forEach((enemyChild) => {
                const enemy = enemyChild as Enemy;
                if (!enemy.active) return;

                const dx = enemy.x - emitterPos.x;
                const dy = enemy.y - emitterPos.y;
                const d = Math.sqrt(dx * dx + dy * dy);

                if (d <= range && d < bestDist) {
                    bestDist = d;
                    bestTarget = enemy;
                }
            });

            if (!bestTarget) return;

            // Aim with LEAD TARGETING - predict where enemy will be
            const target: Enemy = bestTarget;
            const projectileSpeed = def.particleSpeed;

            // Calculate time for projectile to reach current enemy position
            const dx = target.x - emitterPos.x;
            const dy = target.y - emitterPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const timeToHit = dist / projectileSpeed;

            // Get enemy's current velocity/direction
            const enemyDef = ENEMY_DEFS[target.data_.type];
            const pathIdx = target.data_.pathIndex;
            const nextWaypoint = target.worldPath[pathIdx + 1];

            let predictX = target.x;
            let predictY = target.y;

            if (nextWaypoint) {
                // Predict based on enemy speed toward next waypoint
                const toDx = nextWaypoint.x - target.x;
                const toDy = nextWaypoint.y - target.y;
                const toDist = Math.sqrt(toDx * toDx + toDy * toDy);
                if (toDist > 0) {
                    const moveSpeed = target.data_.baseSpeed * (target.data_.slowTimer > 0 ? target.data_.slowFactor : 1);
                    const nx = toDx / toDist;
                    const ny = toDy / toDist;
                    // Lead by predicted travel distance
                    predictX = target.x + nx * moveSpeed * timeToHit * 0.8; // 0.8 = tuning factor
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
        });
    }

    updateProjectiles(dt: number) {
        const toRemove: Projectile[] = [];

        this.projectiles.getChildren().forEach((child) => {
            const proj = child as Projectile;
            if (!proj.active) return;

            const alive = proj.updateProjectile(dt);
            proj.drawTrail();

            if (!alive) {
                toRemove.push(proj);
                return;
            }

            // Check collisions with enemies
            this.enemies.getChildren().forEach((enemyChild) => {
                const enemy = enemyChild as Enemy;
                if (!enemy.active) return;
                if (proj.hasHitEnemy(enemy.data_.id)) return;

                const def = ENEMY_DEFS[enemy.data_.type];
                const dx = enemy.x - proj.x;
                const dy = enemy.y - proj.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < def.size + proj.particleRadius) {
                    // Hit!
                    proj.registerHit(enemy.data_.id);

                    // Apply damage
                    const killed = enemy.takeDamage(proj.data_.damage);

                    if (!killed) {
                        // Apply knockback
                        const body = proj.body as Phaser.Physics.Arcade.Body;
                        const velMag = Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y);
                        if (velMag > 0) {
                            const nx = body.velocity.x / velMag;
                            const ny = body.velocity.y / velMag;
                            enemy.applyKnockback(
                                nx * proj.data_.knockbackForce,
                                ny * proj.data_.knockbackForce
                            );
                        }

                        // Apply special effects
                        const emitterDef = EMITTER_DEFS[proj.data_.type];

                        // Fire DOT
                        if (emitterDef.dotDamage && emitterDef.dotDuration) {
                            enemy.applyDOT(emitterDef.dotDamage, emitterDef.dotDuration);
                        }

                        // Goo slow
                        if (emitterDef.slowFactor && emitterDef.slowDuration) {
                            enemy.applySlow(emitterDef.slowFactor, emitterDef.slowDuration);
                        }

                        // Electric chain
                        if (emitterDef.chainCount && emitterDef.chainCount > 0) {
                            this.chainLightning(enemy, proj.data_.damage * 0.6, emitterDef.chainCount);
                        }

                        // Goo puddle
                        if (emitterDef.puddleDuration) {
                            this.createOrExpandPuddle(proj.x, proj.y, emitterDef);
                        }

                        // Splash damage (area damage)
                        if (emitterDef.splashRadius && emitterDef.splashRadius > 0) {
                            this.applySplashDamage(
                                proj.x,
                                proj.y,
                                emitterDef.splashRadius,
                                proj.data_.damage * 0.5, // Splash does 50% damage
                                enemy.data_.id
                            );
                        }
                    }

                    if (!proj.isAlive()) {
                        toRemove.push(proj);
                    }
                }
            });
        });

        // Clean up dead projectiles
        for (const proj of toRemove) {
            proj.cleanup();
            this.projectiles.remove(proj, true, true);
        }
    }

    updatePuddles(dt: number) {
        const toRemove: Puddle[] = [];

        this.puddles.getChildren().forEach((child) => {
            const puddle = child as Puddle;
            if (!puddle.active) return;

            const alive = puddle.updatePuddle(dt);
            if (!alive) {
                toRemove.push(puddle);
            }
        });

        for (const puddle of toRemove) {
            this.puddles.remove(puddle, true, true);
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
            p.vy += 200 * dt; // gravity
            p.life -= dt;
            p.size *= 0.98; // shrink
            return p.life > 0 && p.size > 0.5;
        });
    }

    drawDeathParticles() {
        const g = this.enemyGraphics; // reuse graphics
        for (const p of this.deathParticles) {
            const alpha = Math.min(1, p.life * 2);
            g.fillStyle(p.color, alpha);
            // Pixel-style squares
            g.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
        }
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
                vy: Math.sin(angle) * speed - 50, // upward bias
                color: Math.random() > 0.3 ? color : this.lightenColor(color, 0.5),
                size: 3 + Math.random() * 4,
                life: 0.5 + Math.random() * 0.5,
            });
        }
    }

    checkWaveCompletion() {
        if (this.state.waveActive &&
            this.enemies.getLength() === 0 &&
            this.state.spawnQueue.length === 0) {
            this.state.waveActive = false;
            const waveDef = generateWave(this.state.wave);
            this.state.gold += waveDef.reward;
            this.events.emit('goldChanged', this.state.gold);
            this.events.emit('waveComplete', this.state.wave);
        }
    }

    // ========== Spawning ==========

    spawnEnemy(type: EnemyType, pos?: Vec2, scale: number = 1) {
        const startPos = pos || { ...this.worldPath[0] };

        const enemy = new Enemy(
            this,
            startPos.x,
            startPos.y,
            this.state.nextId++,
            type,
            this.worldPath,
            this.state.wave,
            scale
        );

        this.enemies.add(enemy);
    }

    spawnProjectile(emitter: Emitter, angle: number, mult: { damage: number; knockback: number }) {
        if (this.projectiles.getLength() >= MAX_PARTICLES) return;

        const def = EMITTER_DEFS[emitter.data_.type];
        const pos = emitter.getPosition();

        // Add spread
        const spreadAngle = angle + (Math.random() - 0.5) * def.spreadAngle;

        const vx = Math.cos(spreadAngle) * def.particleSpeed;
        const vy = Math.sin(spreadAngle) * def.particleSpeed;

        const proj = new Projectile(
            this,
            pos.x,
            pos.y,
            vx,
            vy,
            this.state.nextId++,
            def.type as ParticleType,
            def.damage * mult.damage,
            def.particlePierce,
            def.particleLifespan,
            def.knockbackForce * mult.knockback,
            def.color,
            3 + emitter.data_.level,
            emitter.data_.id
        );

        this.projectiles.add(proj);
    }

    // ========== Special Effects ==========

    applySplashDamage(x: number, y: number, radius: number, damage: number, excludeId: number) {
        // Create splash visual effect
        this.deathParticles.push({
            x, y,
            vx: 0, vy: 0,
            color: 0xff8844,
            size: radius * 0.3,
            life: 0.2,
        });
        // Ring effect
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i;
            this.deathParticles.push({
                x: x + Math.cos(angle) * radius * 0.5,
                y: y + Math.sin(angle) * radius * 0.5,
                vx: Math.cos(angle) * 80,
                vy: Math.sin(angle) * 80,
                color: 0xffaa44,
                size: 4,
                life: 0.3,
            });
        }

        // Apply damage to all enemies in radius (except the one already hit)
        this.enemies.getChildren().forEach((child) => {
            const enemy = child as Enemy;
            if (!enemy.active || enemy.data_.id === excludeId) return;

            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= radius) {
                // Damage falls off with distance
                const falloff = 1 - (dist / radius) * 0.5;
                enemy.takeDamage(damage * falloff);
            }
        });
    }

    chainLightning(startEnemy: Enemy, damage: number, maxChains: number) {
        let lastTarget: Enemy = startEnemy;
        const hit = new Set<number>([startEnemy.data_.id]);

        for (let i = 0; i < maxChains; i++) {
            let nearest: Enemy | null = null;
            let nearestDist = 4 * CELL_SIZE;

            this.enemies.getChildren().forEach((child) => {
                const enemy = child as Enemy;
                if (!enemy.active || hit.has(enemy.data_.id)) return;

                const dx = enemy.x - lastTarget.x;
                const dy = enemy.y - lastTarget.y;
                const d = Math.sqrt(dx * dx + dy * dy);

                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = enemy;
                }
            });

            if (!nearest) break;

            const foundEnemy: Enemy = nearest;
            hit.add(foundEnemy.data_.id);

            // Visual effect
            this.chainEffects.push({
                from: { x: lastTarget.x, y: lastTarget.y },
                to: { x: foundEnemy.x, y: foundEnemy.y },
                timer: 0.1,
            });

            foundEnemy.takeDamage(damage);
            lastTarget = foundEnemy;
        }
    }

    createOrExpandPuddle(x: number, y: number, emitterDef: any) {
        // Check for nearby puddle to expand
        let expanded = false;
        this.puddles.getChildren().forEach((child) => {
            const puddle = child as Puddle;
            if (!puddle.active) return;

            const dx = puddle.data_.x - x;
            const dy = puddle.data_.y - y;
            if (dx * dx + dy * dy < 400) {
                puddle.expand(0.5, emitterDef.puddleDuration, 2, 40);
                expanded = true;
            }
        });

        if (!expanded) {
            const puddle = new Puddle(
                this,
                x,
                y,
                this.state.nextId++,
                15,
                emitterDef.puddleDuration,
                emitterDef.slowFactor,
                emitterDef.color
            );
            this.puddles.add(puddle);
        }
    }

    // ========== Game Actions ==========

    startWave() {
        if (this.state.waveActive || this.state.gameOver) return;

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

        this.events.emit('waveStarted', this.state.wave);
    }

    placeEmitter(gx: number, gy: number, type: EmitterType): boolean {
        if (!this.canPlaceEmitter(gx, gy)) return false;

        const def = EMITTER_DEFS[type];
        if (this.state.gold < def.cost) {
            this.events.emit('insufficientFunds');
            return false;
        }

        this.state.gold -= def.cost;
        this.events.emit('goldChanged', this.state.gold);

        const emitter = new Emitter(this, gx, gy, this.state.nextId++, type);
        this.emitters.add(emitter);
        this.occupiedCells.add(`${gx},${gy}`);

        return true;
    }

    selectEmitter(id: number | null) {
        // Deselect all
        this.emitters.getChildren().forEach((child) => {
            (child as Emitter).setSelected(false);
        });

        this.state.selectedEmitterId = id;

        if (id !== null) {
            const emitter = this.getEmitterById(id);
            if (emitter) {
                emitter.setSelected(true);
            }
        }
    }

    upgradeEmitter(id: number): boolean {
        const emitter = this.getEmitterById(id);
        if (!emitter) return false;

        const cost = getUpgradeCost(emitter.data_.level);
        if (this.state.gold < cost) return false;

        this.state.gold -= cost;
        emitter.upgrade();
        this.events.emit('goldChanged', this.state.gold);
        this.events.emit('emitterUpgraded', emitter);

        return true;
    }

    sellEmitter(id: number): number {
        const emitter = this.getEmitterById(id);
        if (!emitter) return 0;

        const sellValue = emitter.getSellValue();
        this.state.gold += sellValue;

        this.occupiedCells.delete(`${emitter.data_.gridX},${emitter.data_.gridY}`);
        this.emitters.remove(emitter, true, true);

        this.state.selectedEmitterId = null;
        this.events.emit('goldChanged', this.state.gold);

        return sellValue;
    }

    getEmitterById(id: number): Emitter | null {
        const children = this.emitters.getChildren();
        for (const child of children) {
            const emitter = child as Emitter;
            if (emitter.data_.id === id) {
                return emitter;
            }
        }
        return null;
    }

    getEmitterAtGrid(gx: number, gy: number): Emitter | null {
        const children = this.emitters.getChildren();
        for (const child of children) {
            const emitter = child as Emitter;
            if (emitter.data_.gridX === gx && emitter.data_.gridY === gy) {
                return emitter;
            }
        }
        return null;
    }

    // ========== Input Handling ==========

    onPointerMove(pointer: Phaser.Input.Pointer) {
        const grid = this.pixelToGrid(pointer.x, pointer.y);
        this.hoverCell = grid;
    }

    onPointerDown(pointer: Phaser.Input.Pointer) {
        const grid = this.pixelToGrid(pointer.x, pointer.y);
        if (!grid) return;

        if (this.state.selectedEmitterType) {
            // Place new emitter
            if (this.placeEmitter(grid.x, grid.y, this.state.selectedEmitterType)) {
                // Keep type selected for quick placement
            }
        } else {
            // Check if clicking on existing emitter
            const emitter = this.getEmitterAtGrid(grid.x, grid.y);
            if (emitter) {
                this.selectEmitter(emitter.data_.id);
                this.events.emit('emitterSelected', emitter);
            } else {
                this.selectEmitter(null);
                this.events.emit('emitterDeselected');
            }
        }
    }

    onKeyDown(event: KeyboardEvent) {
        if (event.key === '1') this.setSelectedEmitterType('water');
        if (event.key === '2') this.setSelectedEmitterType('fire');
        if (event.key === '3') this.setSelectedEmitterType('electric');
        if (event.key === '4') this.setSelectedEmitterType('goo');
        if (event.key === '5') this.setSelectedEmitterType('sniper');
        if (event.key === '6') this.setSelectedEmitterType('splash');
        if (event.key === 'Escape') {
            this.state.selectedEmitterType = null;
            this.selectEmitter(null);
            this.events.emit('emitterTypeDeselected');
            this.events.emit('emitterDeselected');
        }
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!this.state.waveActive) {
                this.startWave();
            }
        }
        if (event.key === 'p' || event.key === 'P') {
            this.togglePause();
        }
    }

    togglePause() {
        this.autoWaveEnabled = !this.autoWaveEnabled;
        this.state.paused = !this.autoWaveEnabled && !this.state.waveActive;
        this.events.emit('pauseChanged', !this.autoWaveEnabled);
    }

    setSelectedEmitterType(type: EmitterType | null) {
        const def = type ? EMITTER_DEFS[type] : null;

        if (def && this.state.gold < def.cost) {
            this.events.emit('insufficientFunds');
            return; // Can't afford
        }

        if (this.state.selectedEmitterType === type) {
            this.state.selectedEmitterType = null;
        } else {
            this.state.selectedEmitterType = type;
            this.selectEmitter(null);
            this.events.emit('emitterDeselected');
        }

        this.events.emit('emitterTypeChanged', this.state.selectedEmitterType);
    }
}
