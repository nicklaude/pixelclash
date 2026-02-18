/**
 * Settings Menu Types and Defaults
 */

export interface GameSettings {
    spawnRateMultiplier: number;  // 0.5 - 2.0
    autoWaveEnabled: boolean;
    autoWaveDelay: number;        // 1000 - 5000 ms
    showFPS: boolean;
    showEntityCount: boolean;
    difficulty: 'easy' | 'normal' | 'hard';
    soundEnabled: boolean;
    musicEnabled: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
    spawnRateMultiplier: 1.0,
    autoWaveEnabled: true,
    autoWaveDelay: 2000,
    showFPS: false,
    showEntityCount: false,
    difficulty: 'normal',
    soundEnabled: true,
    musicEnabled: true,
};

export interface DifficultyPreset {
    startingGold: number;
    startingHealth: number;
    enemyHealthScale: number;
    waveRewardScale: number;
    spawnRateMultiplier: number;
}

export const DIFFICULTY_PRESETS: Record<GameSettings['difficulty'], DifficultyPreset> = {
    easy: {
        startingGold: 300,
        startingHealth: 30,
        enemyHealthScale: 0.8,
        waveRewardScale: 1.2,
        spawnRateMultiplier: 0.8,
    },
    normal: {
        startingGold: 200,
        startingHealth: 20,
        enemyHealthScale: 1.0,
        waveRewardScale: 1.0,
        spawnRateMultiplier: 1.0,
    },
    hard: {
        startingGold: 150,
        startingHealth: 10,
        enemyHealthScale: 1.3,
        waveRewardScale: 0.8,
        spawnRateMultiplier: 1.2,
    },
};

const STORAGE_KEY = 'pixelclash_settings';

export function saveSettings(settings: GameSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e);
    }
}

export function loadSettings(): GameSettings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Merge with defaults in case new settings were added
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
    }
    return { ...DEFAULT_SETTINGS };
}
