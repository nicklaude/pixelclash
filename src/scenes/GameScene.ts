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

        // Draw dynamic elements
        this.drawNexus();
        this.drawEnemies();
        this.drawChainEffects();
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

            // Flash effect
            let color = def.color;
            if (enemy.data_.flashTimer > 0) {
                color = 0xffffff;
            }

            // DOT fire effect
            if (enemy.data_.dotTimer > 0) {
                for (let i = 0; i < 3; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = def.size * 0.5 + Math.random() * 5;
                    const fx = enemy.x + Math.cos(angle) * dist;
                    const fy = enemy.y + Math.sin(angle) * dist;
                    g.fillStyle(0xff6600, 0.7);
                    g.fillCircle(fx, fy, 2 + Math.random() * 2);
                }
            }

            // Squash and stretch based on knockback
            const speed = Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y);
            const stretch = 1 + Math.min(speed / 200, 0.4);

            // Draw enemy body
            g.fillStyle(color, 1);
            if (stretch > 1.1) {
                // Stretched ellipse in direction of movement
                const angle = Math.atan2(body.velocity.y, body.velocity.x);
                g.save();
                g.translateCanvas(enemy.x, enemy.y);
                g.rotateCanvas(angle);
                g.scaleCanvas(stretch, 1 / stretch);
                g.fillCircle(0, 0, def.size);
                g.restore();
            } else {
                g.fillCircle(enemy.x, enemy.y, def.size);
            }

            // Eye indicator
            g.fillStyle(0x000000, 1);
            g.fillCircle(enemy.x + def.size * 0.3, enemy.y - def.size * 0.2, def.size * 0.2);
        });
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

            g.fillStyle(valid ? 0x00ff00 : 0xff0000, 0.3);
            g.fillRect(
                this.hoverCell.x * CELL_SIZE,
                this.hoverCell.y * CELL_SIZE + this.gameOffsetY,
                CELL_SIZE,
                CELL_SIZE
            );

            g.lineStyle(2, valid ? 0x00ff00 : 0xff0000, 1);
            g.strokeRect(
                this.hoverCell.x * CELL_SIZE + 1,
                this.hoverCell.y * CELL_SIZE + 1 + this.gameOffsetY,
                CELL_SIZE - 2,
                CELL_SIZE - 2
            );
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
                } else if (enemy.data_.health <= 0) {
                    // Killed - give reward
                    this.state.gold += enemy.data_.reward;
                    this.events.emit('goldChanged', this.state.gold);

                    // Handle splitter
                    const def = ENEMY_DEFS[enemy.data_.type];
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

            // Aim and fire
            const target: Enemy = bestTarget;
            emitter.aimAt(target.x, target.y);
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
        if (this.state.gold < def.cost) return false;

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
