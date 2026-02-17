// ---- Game Types ----

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export type TowerType = 'shooter' | 'zapper' | 'slower' | 'cannon';
export type EnemyType = 'grunt' | 'tank' | 'fast' | 'shielded';

export interface TowerDef {
    type: TowerType;
    cost: number;
    range: number;
    damage: number;
    fireRate: number; // shots per second
    color: number;
    height: number;
    description: string;
    // Special properties
    aoe?: number;         // area of effect radius (cannon)
    chainCount?: number;  // number of chain targets (zapper)
    slowFactor?: number;  // speed multiplier (slower)
    slowDuration?: number;
}

export interface EnemyDef {
    type: EnemyType;
    health: number;
    speed: number;
    reward: number;
    color: number;
    size: number;
    // Resistances: 0 = normal, positive = resistant, negative = weak
    resistances: {
        bullet: number;
        electric: number;
        slow: number;
        explosive: number;
    };
}

export interface Tower {
    id: number;
    type: TowerType;
    gridX: number;
    gridZ: number;
    level: number;
    cooldown: number;
    mesh: any; // THREE.Mesh
    rangeMesh?: any;
    targetId: number | null;
}

export interface Enemy {
    id: number;
    type: EnemyType;
    health: number;
    maxHealth: number;
    speed: number;
    pathIndex: number;      // current path segment index
    pathProgress: number;   // 0-1 along current segment
    position: Vec3;
    slowTimer: number;
    slowFactor: number;
    mesh: any; // THREE.Mesh
    healthBar?: any;
    alive: boolean;
    reward: number;
}

export interface Projectile {
    id: number;
    position: Vec3;
    targetId: number;
    damage: number;
    speed: number;
    type: 'bullet' | 'zap' | 'cannonball';
    aoe?: number;
    chainCount?: number;
    mesh: any;
    alive: boolean;
}

export interface WaveDef {
    enemies: Array<{
        type: EnemyType;
        count: number;
        delay: number; // ms between spawns
    }>;
    reward: number; // bonus gold for completing wave
}

export interface GameState {
    gold: number;
    health: number;
    wave: number;
    waveActive: boolean;
    towers: Tower[];
    enemies: Enemy[];
    projectiles: Projectile[];
    selectedTowerType: TowerType | null;
    selectedTower: Tower | null;
    nextId: number;
    spawnQueue: Array<{ type: EnemyType; spawnAt: number }>;
    gameOver: boolean;
    paused: boolean;
}

export interface PathNode {
    x: number;
    z: number;
}
