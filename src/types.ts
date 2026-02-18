// ---- 2D Particle Tower Defense Types (Phaser Edition) ----

export interface Vec2 {
    x: number;
    y: number;
}

export type EmitterType = 'water' | 'fire' | 'electric' | 'goo' | 'sniper' | 'splash';
export type EnemyType = 'grunt' | 'tank' | 'fast' | 'shielded' | 'splitter' | 'boss' | 'healer' | 'cloaked';
export type ParticleType = 'water' | 'fire' | 'electric' | 'goo' | 'sniper' | 'splash';

export interface EmitterDef {
    type: EmitterType;
    cost: number;
    range: number;
    damage: number;
    fireRate: number;           // particles per second
    color: number;
    particlesPerShot: number;
    particleSpeed: number;
    particlePierce: number;     // how many enemies a particle can hit
    particleLifespan: number;   // seconds until particle expires
    spreadAngle: number;        // cone of fire in radians
    knockbackForce: number;     // force applied to enemies on hit
    description: string;
    // Special properties
    dotDamage?: number;         // damage over time (fire)
    dotDuration?: number;
    chainCount?: number;        // chain targets (electric)
    slowFactor?: number;        // speed multiplier (goo)
    slowDuration?: number;
    puddleDuration?: number;    // goo puddles on ground
    splashRadius?: number;      // area damage radius (splash tower)
}

export interface EnemyDef {
    type: EnemyType;
    health: number;
    speed: number;
    reward: number;
    color: number;
    size: number;
    mass: number;               // affects knockback resistance (inverse)
    friction: number;           // how fast knockback decays (0-1, higher = slower decay)
    splitCount?: number;        // for splitter enemies
    spawnMinions?: boolean;     // for boss enemies
    healRadius?: number;        // for healer enemies - range to heal allies
    healAmount?: number;        // HP per second healed
    cloaked?: boolean;          // for cloaked enemies - harder to target
}

export interface EmitterData {
    id: number;
    type: EmitterType;
    gridX: number;
    gridY: number;
    level: number;
    cooldown: number;
    angle: number;              // current aim direction
    targetId: number | null;
    totalInvestment: number;    // tracks base cost + all upgrade costs for sell value
}

export interface EnemyData {
    id: number;
    type: EnemyType;
    health: number;
    maxHealth: number;
    baseSpeed: number;
    mass: number;
    friction: number;
    pathIndex: number;
    pathProgress: number;
    slowTimer: number;
    slowFactor: number;
    dotTimer: number;           // damage over time remaining
    dotDamage: number;          // damage per tick
    reward: number;
    flashTimer: number;         // flash on hit
}

export interface ParticleData {
    id: number;
    damage: number;
    pierce: number;             // hits remaining
    lifespan: number;           // time remaining
    type: ParticleType;
    knockbackForce: number;
    hitEnemies: Set<number>;    // track which enemies already hit
    sourceEmitterId: number;
}

export interface PuddleData {
    id: number;
    x: number;
    y: number;
    radius: number;
    duration: number;
    slowFactor: number;
    color: number;
}

export interface WaveDef {
    enemies: Array<{
        type: EnemyType;
        count: number;
        delay: number;
    }>;
    reward: number;
}

export interface PathNode {
    x: number;
    y: number;
}

export interface GameState {
    gold: number;
    health: number;
    wave: number;
    waveActive: boolean;
    selectedEmitterType: EmitterType | null;
    selectedEmitterId: number | null;
    nextId: number;
    spawnQueue: Array<{ type: EnemyType; spawnAt: number }>;
    gameOver: boolean;
    paused: boolean;
}

// ============================================================================
// Tile types (kept for interface compatibility, not used with fixed path)
// ============================================================================

export type TileType = 'sand' | 'stone' | 'water' | 'nexus' | 'foundation';

// Tile type constants (kept for compatibility)
export const TILE_SAND = 0;
export const TILE_STONE = 1;
export const TILE_WATER = 2;
export const TILE_NEXUS = 3;
export const TILE_FOUNDATION = 4;

export interface MapData {
    tiles: Uint8Array;            // Flattened [y * width + x] grid
    width: number;
    height: number;
    path: Vec2[];                 // World-space waypoints
    foundationCells: Vec2[];      // Valid turret placement cells
    nexus: Vec2;                  // Grid coords of nexus
    spawnPoint: Vec2;             // Grid coords of enemy spawn
}
