import {
    GameState, Tower, Enemy, Projectile, TowerType, EnemyType, Vec3,
} from './types';
import {
    TOWER_DEFS, ENEMY_DEFS, PATH, CELL_SIZE, GRID_OFFSET, NEXUS_X, NEXUS_Z,
    STARTING_GOLD, STARTING_HEALTH, generateWave, getUpgradeCost, getUpgradeMultiplier,
    getPathCells,
} from './config';
import { Renderer } from './renderer';

export class Game {
    state: GameState;
    renderer: Renderer;
    pathCells: Set<string>;
    occupiedCells: Set<string>;
    hoverCell: { x: number; z: number } | null = null;

    // World-space path points (for enemy movement)
    worldPath: Vec3[];

    // UI refs
    private goldEl!: HTMLElement;
    private healthEl!: HTMLElement;
    private waveEl!: HTMLElement;
    private startWaveBtn!: HTMLElement;
    private upgradeBtn!: HTMLElement;
    private upgradeCostEl!: HTMLElement;
    private sellBtn!: HTMLElement;
    private sellValueEl!: HTMLElement;
    private towerInfo!: HTMLElement;
    private towerInfoName!: HTMLElement;
    private towerInfoLevel!: HTMLElement;
    private towerInfoStats!: HTMLElement;
    private gameOverEl!: HTMLElement;
    private finalWaveEl!: HTMLElement;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new Renderer(canvas);
        this.pathCells = getPathCells();
        this.occupiedCells = new Set();

        // Convert grid path to world coords
        this.worldPath = PATH.map(p => ({
            x: p.x * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
            y: 0.5,
            z: p.z * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
        }));

        this.state = {
            gold: STARTING_GOLD,
            health: STARTING_HEALTH,
            wave: 0,
            waveActive: false,
            towers: [],
            enemies: [],
            projectiles: [],
            selectedTowerType: null,
            selectedTower: null,
            nextId: 1,
            spawnQueue: [],
            gameOver: false,
            paused: false,
        };

        this.bindUI();
        this.bindInput(canvas);
        this.updateUI();
    }

    private bindUI() {
        this.goldEl = document.getElementById('gold')!;
        this.healthEl = document.getElementById('health')!;
        this.waveEl = document.getElementById('wave-num')!;
        this.startWaveBtn = document.getElementById('start-wave')!;
        this.upgradeBtn = document.getElementById('upgrade-btn')!;
        this.upgradeCostEl = document.getElementById('upgrade-cost')!;
        this.sellBtn = document.getElementById('sell-btn')!;
        this.sellValueEl = document.getElementById('sell-value')!;
        this.towerInfo = document.getElementById('tower-info')!;
        this.towerInfoName = document.getElementById('tower-info-name')!;
        this.towerInfoLevel = document.getElementById('tower-info-level')!;
        this.towerInfoStats = document.getElementById('tower-info-stats')!;
        this.gameOverEl = document.getElementById('game-over')!;
        this.finalWaveEl = document.getElementById('final-wave')!;

        // Tower selection buttons
        document.querySelectorAll('.tower-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = (btn as HTMLElement).dataset.tower as TowerType;
                this.selectTowerType(type);
            });
        });

        // Start wave
        this.startWaveBtn.addEventListener('click', () => this.startWave());

        // Upgrade
        this.upgradeBtn.addEventListener('click', () => this.upgradeTower());

        // Sell
        this.sellBtn.addEventListener('click', () => this.sellTower());

        // Restart
        document.getElementById('restart-btn')!.addEventListener('click', () => {
            location.reload();
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === '1') this.selectTowerType('shooter');
            if (e.key === '2') this.selectTowerType('zapper');
            if (e.key === '3') this.selectTowerType('slower');
            if (e.key === '4') this.selectTowerType('cannon');
            if (e.key === 'Escape') {
                this.state.selectedTowerType = null;
                this.state.selectedTower = null;
                this.updateTowerButtons();
                this.hideTowerInfo();
            }
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!this.state.waveActive) this.startWave();
            }
        });
    }

    private bindInput(canvas: HTMLCanvasElement) {
        canvas.addEventListener('mousemove', (e) => {
            const grid = this.renderer.getMouseGridPos(e);
            this.renderer.clearHighlights();
            if (grid && this.state.selectedTowerType) {
                const canPlace = this.canPlaceTower(grid.x, grid.z);
                this.renderer.highlightCell(grid.x, grid.z, canPlace);
            }
            this.hoverCell = grid;
        });

        canvas.addEventListener('click', (e) => {
            const grid = this.renderer.getMouseGridPos(e);
            if (!grid) return;

            if (this.state.selectedTowerType) {
                this.placeTower(grid.x, grid.z, this.state.selectedTowerType);
            } else {
                // Check if clicking on existing tower
                const tower = this.state.towers.find(t => t.gridX === grid.x && t.gridZ === grid.z);
                if (tower) {
                    this.selectTower(tower);
                } else {
                    this.state.selectedTower = null;
                    this.hideTowerInfo();
                }
            }
        });
    }

    selectTowerType(type: TowerType) {
        const def = TOWER_DEFS[type];
        if (this.state.gold < def.cost) return;

        if (this.state.selectedTowerType === type) {
            this.state.selectedTowerType = null;
        } else {
            this.state.selectedTowerType = type;
            this.state.selectedTower = null;
            this.hideTowerInfo();
        }
        this.updateTowerButtons();
    }

    canPlaceTower(gx: number, gz: number): boolean {
        const key = `${gx},${gz}`;
        if (this.pathCells.has(key)) return false;
        if (this.occupiedCells.has(key)) return false;
        if (gx === NEXUS_X && gz === NEXUS_Z) return false;
        return true;
    }

    placeTower(gx: number, gz: number, type: TowerType) {
        if (!this.canPlaceTower(gx, gz)) return;
        const def = TOWER_DEFS[type];
        if (this.state.gold < def.cost) return;

        this.state.gold -= def.cost;
        const pos = this.renderer.gridToWorld(gx, gz);
        const mesh = this.renderer.createTowerMesh(type, def.color, def.height);
        mesh.position.set(pos.x, def.height / 2, pos.z);

        const tower: Tower = {
            id: this.state.nextId++,
            type,
            gridX: gx,
            gridZ: gz,
            level: 0,
            cooldown: 0,
            mesh,
            targetId: null,
        };

        this.state.towers.push(tower);
        this.occupiedCells.add(`${gx},${gz}`);
        this.updateUI();
    }

    selectTower(tower: Tower) {
        this.state.selectedTower = tower;
        this.state.selectedTowerType = null;
        this.updateTowerButtons();
        this.showTowerInfo(tower);

        // Show range indicator
        if (tower.rangeMesh) {
            this.renderer.removeMesh(tower.rangeMesh);
        }
        const def = TOWER_DEFS[tower.type];
        const mult = getUpgradeMultiplier(tower.level);
        tower.rangeMesh = this.renderer.createRangeIndicator(def.range * mult.range);
        const pos = this.renderer.gridToWorld(tower.gridX, tower.gridZ);
        tower.rangeMesh.position.set(pos.x, 0.05, pos.z);
    }

    showTowerInfo(tower: Tower) {
        const def = TOWER_DEFS[tower.type];
        const mult = getUpgradeMultiplier(tower.level);
        this.towerInfoName.textContent = def.type.charAt(0).toUpperCase() + def.type.slice(1);
        this.towerInfoLevel.textContent = `Lv.${tower.level + 1}`;
        this.towerInfoStats.textContent = `DMG:${Math.round(def.damage * mult.damage)} RNG:${(def.range * mult.range).toFixed(1)} ROF:${(def.fireRate * mult.fireRate).toFixed(1)}`;
        this.towerInfo.style.display = 'flex';

        const upgCost = getUpgradeCost(tower.level);
        this.upgradeCostEl.textContent = String(upgCost);
        this.upgradeBtn.style.display = 'inline-block';

        const sellValue = Math.floor(def.cost * 0.6 * (1 + tower.level * 0.3));
        this.sellValueEl.textContent = String(sellValue);
        this.sellBtn.style.display = 'inline-block';
    }

    hideTowerInfo() {
        this.towerInfo.style.display = 'none';
        this.upgradeBtn.style.display = 'none';
        this.sellBtn.style.display = 'none';

        // Remove range indicators
        for (const t of this.state.towers) {
            if (t.rangeMesh) {
                this.renderer.removeMesh(t.rangeMesh);
                t.rangeMesh = undefined;
            }
        }
    }

    upgradeTower() {
        const tower = this.state.selectedTower;
        if (!tower) return;
        const cost = getUpgradeCost(tower.level);
        if (this.state.gold < cost) return;

        this.state.gold -= cost;
        tower.level++;

        // Visually grow tower
        const def = TOWER_DEFS[tower.type];
        const newHeight = def.height + tower.level * 0.5;
        tower.mesh.scale.y = newHeight;
        tower.mesh.position.y = newHeight / 2;

        // Refresh range
        if (tower.rangeMesh) {
            this.renderer.removeMesh(tower.rangeMesh);
        }
        const mult = getUpgradeMultiplier(tower.level);
        tower.rangeMesh = this.renderer.createRangeIndicator(def.range * mult.range);
        const pos = this.renderer.gridToWorld(tower.gridX, tower.gridZ);
        tower.rangeMesh.position.set(pos.x, 0.05, pos.z);

        this.showTowerInfo(tower);
        this.updateUI();
    }

    sellTower() {
        const tower = this.state.selectedTower;
        if (!tower) return;
        const def = TOWER_DEFS[tower.type];
        const sellValue = Math.floor(def.cost * 0.6 * (1 + tower.level * 0.3));
        this.state.gold += sellValue;

        this.renderer.removeMesh(tower.mesh);
        if (tower.rangeMesh) this.renderer.removeMesh(tower.rangeMesh);

        this.occupiedCells.delete(`${tower.gridX},${tower.gridZ}`);
        this.state.towers = this.state.towers.filter(t => t.id !== tower.id);
        this.state.selectedTower = null;
        this.hideTowerInfo();
        this.updateUI();
    }

    startWave() {
        if (this.state.waveActive || this.state.gameOver) return;
        this.state.wave++;
        this.state.waveActive = true;
        this.startWaveBtn.textContent = `Wave ${this.state.wave}...`;
        this.startWaveBtn.classList.add('active-wave');

        const waveDef = generateWave(this.state.wave);
        const healthScale = 1 + (this.state.wave - 1) * 0.2;
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
        this.updateUI();
    }

    spawnEnemy(type: EnemyType) {
        const def = ENEMY_DEFS[type];
        const healthScale = 1 + (this.state.wave - 1) * 0.2;
        const scaledHealth = Math.round(def.health * healthScale);

        const startPos = { ...this.worldPath[0] };
        const mesh = this.renderer.createEnemyMesh(def.color, def.size);
        mesh.position.set(startPos.x, startPos.y, startPos.z);

        const healthBar = this.renderer.createHealthBar();

        const enemy: Enemy = {
            id: this.state.nextId++,
            type,
            health: scaledHealth,
            maxHealth: scaledHealth,
            speed: def.speed,
            pathIndex: 0,
            pathProgress: 0,
            position: startPos,
            slowTimer: 0,
            slowFactor: 1,
            mesh,
            healthBar,
            alive: true,
            reward: def.reward,
        };

        this.state.enemies.push(enemy);
    }

    update(dt: number) {
        if (this.state.gameOver || this.state.paused) return;

        const now = performance.now();

        // Process spawn queue
        const toSpawn = this.state.spawnQueue.filter(s => now >= s.spawnAt);
        for (const s of toSpawn) {
            this.spawnEnemy(s.type);
        }
        this.state.spawnQueue = this.state.spawnQueue.filter(s => now < s.spawnAt);

        // Update enemies
        this.updateEnemies(dt);

        // Update towers
        this.updateTowers(dt);

        // Update projectiles
        this.updateProjectiles(dt);

        // Cleanup dead
        this.cleanup();

        // Check wave complete
        if (this.state.waveActive && this.state.enemies.length === 0 && this.state.spawnQueue.length === 0) {
            this.state.waveActive = false;
            const waveDef = generateWave(this.state.wave);
            this.state.gold += waveDef.reward;
            this.startWaveBtn.textContent = 'Start Wave';
            this.startWaveBtn.classList.remove('active-wave');
            this.updateUI();
        }

        // Check game over
        if (this.state.health <= 0) {
            this.state.gameOver = true;
            this.finalWaveEl.textContent = String(this.state.wave);
            this.gameOverEl.style.display = 'flex';
        }
    }

    private updateEnemies(dt: number) {
        const now = performance.now();
        for (const enemy of this.state.enemies) {
            if (!enemy.alive) continue;

            // Apply slow
            let speedMult = 1;
            if (enemy.slowTimer > 0) {
                speedMult = enemy.slowFactor;
                enemy.slowTimer -= dt;
            }

            // Move along path
            const currentTarget = this.worldPath[enemy.pathIndex + 1];
            if (!currentTarget) {
                // Reached the end (nexus) - damage player
                this.state.health -= 1;
                enemy.alive = false;
                this.renderer.removeMesh(enemy.mesh);
                if (enemy.healthBar) this.renderer.removeMesh(enemy.healthBar);
                this.updateUI();
                continue;
            }

            const dx = currentTarget.x - enemy.position.x;
            const dz = currentTarget.z - enemy.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const moveSpeed = enemy.speed * speedMult * CELL_SIZE;
            const moveAmount = moveSpeed * dt;

            if (moveAmount >= dist) {
                // Reached this waypoint
                enemy.position.x = currentTarget.x;
                enemy.position.z = currentTarget.z;
                enemy.pathIndex++;
            } else {
                enemy.position.x += (dx / dist) * moveAmount;
                enemy.position.z += (dz / dist) * moveAmount;
            }

            // Bobbing animation
            const bob = Math.sin(now * 0.005 + enemy.id * 1.7) * 0.15;
            enemy.mesh.position.set(enemy.position.x, enemy.position.y + bob, enemy.position.z);
            enemy.mesh.rotation.y += dt * 2;

            // Health bar
            if (enemy.healthBar) {
                const pct = enemy.health / enemy.maxHealth;
                enemy.healthBar.scale.x = pct;
                enemy.healthBar.position.set(
                    enemy.position.x,
                    enemy.position.y + 1.5,
                    enemy.position.z
                );
                // Color based on health
                const hbMat = enemy.healthBar.material as THREE.MeshBasicMaterial;
                if (pct > 0.5) hbMat.color.setHex(0x44ff44);
                else if (pct > 0.25) hbMat.color.setHex(0xffcc00);
                else hbMat.color.setHex(0xff4444);
                // Face camera
                enemy.healthBar.lookAt(this.renderer.camera.position);
            }
        }
    }

    private updateTowers(dt: number) {
        for (const tower of this.state.towers) {
            tower.cooldown = Math.max(0, tower.cooldown - dt);
            if (tower.cooldown > 0) continue;

            const def = TOWER_DEFS[tower.type];
            const mult = getUpgradeMultiplier(tower.level);
            const range = def.range * mult.range * CELL_SIZE;
            const towerPos = this.renderer.gridToWorld(tower.gridX, tower.gridZ);

            // Find target
            let bestTarget: Enemy | null = null;
            let bestDist = Infinity;

            for (const enemy of this.state.enemies) {
                if (!enemy.alive) continue;
                const dx = enemy.position.x - towerPos.x;
                const dz = enemy.position.z - towerPos.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d <= range && d < bestDist) {
                    bestDist = d;
                    bestTarget = enemy;
                }
            }

            if (!bestTarget) continue;

            // Fire!
            tower.cooldown = 1 / (def.fireRate * mult.fireRate);

            if (tower.type === 'slower') {
                // Slower: apply slow to all enemies in range
                for (const enemy of this.state.enemies) {
                    if (!enemy.alive) continue;
                    const dx = enemy.position.x - towerPos.x;
                    const dz = enemy.position.z - towerPos.z;
                    const d = Math.sqrt(dx * dx + dz * dz);
                    if (d <= range) {
                        const resistance = ENEMY_DEFS[enemy.type].resistances.slow;
                        const effectiveSlow = def.slowFactor! + resistance * 0.3;
                        enemy.slowFactor = Math.max(0.1, effectiveSlow);
                        enemy.slowTimer = def.slowDuration!;
                        // Also do some damage
                        this.damageEnemy(enemy, def.damage * mult.damage, 'slow');
                    }
                }
                // Visual pulse on tower
                tower.mesh.scale.x = CELL_SIZE * 0.75;
                tower.mesh.scale.z = CELL_SIZE * 0.75;
                setTimeout(() => {
                    tower.mesh.scale.x = CELL_SIZE * 0.6;
                    tower.mesh.scale.z = CELL_SIZE * 0.6;
                }, 100);
            } else {
                // Shoot projectile
                const projType = tower.type === 'zapper' ? 'zap' :
                                 tower.type === 'cannon' ? 'cannonball' : 'bullet';
                const mesh = this.renderer.createProjectileMesh(projType);
                mesh.position.set(towerPos.x, 1.5, towerPos.z);

                const proj: Projectile = {
                    id: this.state.nextId++,
                    position: { x: towerPos.x, y: 1.5, z: towerPos.z },
                    targetId: bestTarget.id,
                    damage: def.damage * mult.damage,
                    speed: 20,
                    type: projType,
                    aoe: def.aoe,
                    chainCount: def.chainCount,
                    mesh,
                    alive: true,
                };
                this.state.projectiles.push(proj);
            }
        }
    }

    private updateProjectiles(dt: number) {
        for (const proj of this.state.projectiles) {
            if (!proj.alive) continue;

            const target = this.state.enemies.find(e => e.id === proj.targetId && e.alive);
            if (!target) {
                proj.alive = false;
                this.renderer.removeMesh(proj.mesh);
                continue;
            }

            const dx = target.position.x - proj.position.x;
            const dy = target.position.y - proj.position.y;
            const dz = target.position.z - proj.position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const moveAmount = proj.speed * dt;

            if (moveAmount >= dist) {
                // Hit!
                proj.alive = false;
                this.renderer.removeMesh(proj.mesh);

                if (proj.aoe && proj.aoe > 0) {
                    // AOE damage
                    const aoeRange = proj.aoe * CELL_SIZE;
                    for (const enemy of this.state.enemies) {
                        if (!enemy.alive) continue;
                        const ex = enemy.position.x - target.position.x;
                        const ez = enemy.position.z - target.position.z;
                        const ed = Math.sqrt(ex * ex + ez * ez);
                        if (ed <= aoeRange) {
                            const falloff = 1 - (ed / aoeRange) * 0.5;
                            this.damageEnemy(enemy, proj.damage * falloff, 'explosive');
                        }
                    }
                } else if (proj.chainCount && proj.chainCount > 0) {
                    // Chain damage
                    this.damageEnemy(target, proj.damage, 'electric');
                    let lastTarget = target;
                    let chainsLeft = proj.chainCount;
                    const hit = new Set([target.id]);

                    while (chainsLeft > 0) {
                        let nearest: Enemy | null = null;
                        let nearestDist = 4 * CELL_SIZE;
                        for (const enemy of this.state.enemies) {
                            if (!enemy.alive || hit.has(enemy.id)) continue;
                            const cdx = enemy.position.x - lastTarget.position.x;
                            const cdz = enemy.position.z - lastTarget.position.z;
                            const cd = Math.sqrt(cdx * cdx + cdz * cdz);
                            if (cd < nearestDist) {
                                nearestDist = cd;
                                nearest = enemy;
                            }
                        }
                        if (!nearest) break;
                        hit.add(nearest.id);
                        this.damageEnemy(nearest, proj.damage * 0.7, 'electric');
                        lastTarget = nearest;
                        chainsLeft--;
                    }
                } else {
                    this.damageEnemy(target, proj.damage, 'bullet');
                }
            } else {
                proj.position.x += (dx / dist) * moveAmount;
                proj.position.y += (dy / dist) * moveAmount;
                proj.position.z += (dz / dist) * moveAmount;
                proj.mesh.position.set(proj.position.x, proj.position.y, proj.position.z);
            }
        }
    }

    private damageEnemy(enemy: Enemy, baseDamage: number, damageType: string) {
        const resistance = (ENEMY_DEFS[enemy.type].resistances as any)[damageType] || 0;
        const effectiveDamage = baseDamage * (1 - resistance);
        enemy.health -= Math.max(1, effectiveDamage);

        if (enemy.health <= 0) {
            enemy.alive = false;
            this.state.gold += enemy.reward;
            this.renderer.removeMesh(enemy.mesh);
            if (enemy.healthBar) this.renderer.removeMesh(enemy.healthBar);
            this.updateUI();
        }
    }

    private cleanup() {
        this.state.enemies = this.state.enemies.filter(e => e.alive);
        this.state.projectiles = this.state.projectiles.filter(p => p.alive);
    }

    private updateTowerButtons() {
        document.querySelectorAll('.tower-btn').forEach(btn => {
            const type = (btn as HTMLElement).dataset.tower as TowerType;
            const def = TOWER_DEFS[type];
            btn.classList.toggle('selected', this.state.selectedTowerType === type);
            btn.classList.toggle('disabled', this.state.gold < def.cost);
        });
    }

    updateUI() {
        this.goldEl.textContent = String(this.state.gold);
        this.healthEl.textContent = String(this.state.health);
        this.waveEl.textContent = String(this.state.wave);
        this.updateTowerButtons();
    }
}
