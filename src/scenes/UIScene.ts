import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { Emitter } from '../objects/Emitter';
import { EmitterType } from '../types';
import { EMITTER_DEFS, getUpgradeCost, getUpgradeMultiplier, UI_TOP_HEIGHT, UI_BOTTOM_HEIGHT, CANVAS_HEIGHT } from '../config';

export class UIScene extends Phaser.Scene {
    gameScene!: GameScene;

    // UI Elements
    goldText!: Phaser.GameObjects.Text;
    healthText!: Phaser.GameObjects.Text;
    waveText!: Phaser.GameObjects.Text;
    pauseText!: Phaser.GameObjects.Text;
    waveCountdownText!: Phaser.GameObjects.Text;
    highScoreText!: Phaser.GameObjects.Text;

    // Flash effect state
    goldFlashTimer: number = 0;

    towerButtons: Map<EmitterType, Phaser.GameObjects.Container> = new Map();
    pauseButton!: Phaser.GameObjects.Container;
    upgradeButton!: Phaser.GameObjects.Container;
    sellButton!: Phaser.GameObjects.Container;

    towerInfoPanel!: Phaser.GameObjects.Container;
    towerInfoName!: Phaser.GameObjects.Text;
    towerInfoLevel!: Phaser.GameObjects.Text;
    towerInfoStats!: Phaser.GameObjects.Text;

    gameOverPanel!: Phaser.GameObjects.Container;
    finalWaveText!: Phaser.GameObjects.Text;

    constructor() {
        super({ key: 'UIScene' });
    }

    init(data: { gameScene: GameScene }) {
        this.gameScene = data.gameScene;
    }

    update(time: number, delta: number) {
        const dt = delta / 1000;

        // Gold flash effect
        if (this.goldFlashTimer > 0) {
            this.goldFlashTimer -= dt;
            const flash = Math.sin(this.goldFlashTimer * 20) > 0;
            this.goldText.setColor(flash ? '#ff4444' : '#ffcc44');
            this.goldText.setScale(flash ? 1.1 : 1);
            if (this.goldFlashTimer <= 0) {
                this.goldText.setColor('#ffcc44');
                this.goldText.setScale(1);
            }
        }

        // Wave countdown display
        const gs = this.gameScene;
        if (gs.autoWaveEnabled && !gs.state.waveActive && !gs.state.gameOver) {
            const secondsLeft = Math.ceil(gs.autoWaveTimer / 1000);
            this.waveCountdownText.setText(`Next wave in ${secondsLeft}s`);
            this.waveCountdownText.setVisible(true);
        } else {
            this.waveCountdownText.setVisible(false);
        }
    }

    create() {
        const { width, height } = this.scale;

        // Top HUD bar
        this.createTopHUD(width);

        // Bottom HUD bar
        this.createBottomHUD(width, height);

        // Tower info panel (hidden by default)
        this.createTowerInfoPanel(width, height);

        // Game over panel (hidden by default)
        this.createGameOverPanel(width, height);

        // Subscribe to game events
        this.subscribeToEvents();

        // Initial UI update
        this.updateUI();
    }

    createTopHUD(width: number) {
        // Background
        const bg = this.add.rectangle(width / 2, UI_TOP_HEIGHT / 2, width, UI_TOP_HEIGHT, 0x111122, 0.95);

        // Wave info
        this.waveText = this.add.text(20, 15, 'Wave: 0', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
        });

        // Health info
        this.healthText = this.add.text(140, 15, '❤️ 20', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ff6666',
        });

        // Gold info
        this.goldText = this.add.text(240, 15, '💰 120', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ffcc44',
        });

        // Pause indicator
        this.pauseText = this.add.text(width - 80, 15, '▶ AUTO', {
            fontSize: '14px',
            fontFamily: 'Courier New, monospace',
            color: '#44ff44',
        });

        // Wave countdown timer (between waves)
        this.waveCountdownText = this.add.text(width / 2, 15, '', {
            fontSize: '14px',
            fontFamily: 'Courier New, monospace',
            color: '#88aaff',
        });
        this.waveCountdownText.setOrigin(0.5, 0);

        // High score display
        this.highScoreText = this.add.text(width / 2, 32, '', {
            fontSize: '12px',
            fontFamily: 'Courier New, monospace',
            color: '#888888',
        });
        this.highScoreText.setOrigin(0.5, 0);
        this.updateHighScoreDisplay();
    }

    createBottomHUD(width: number, height: number) {
        const bottomY = height - UI_BOTTOM_HEIGHT / 2;

        // Background
        const bg = this.add.rectangle(width / 2, bottomY, width, UI_BOTTOM_HEIGHT, 0x111122, 0.95);

        // Tower buttons
        const towers: EmitterType[] = ['water', 'fire', 'electric', 'goo', 'sniper', 'splash'];
        const buttonWidth = 50;
        const buttonGap = 6;
        const startX = 30;

        towers.forEach((type, index) => {
            const x = startX + index * (buttonWidth + buttonGap);
            const y = bottomY;
            const button = this.createTowerButton(x, y, type);
            this.towerButtons.set(type, button);
        });

        // Pause/Play button
        this.pauseButton = this.createActionButton(
            width - 60,
            bottomY - 15,
            '⏸ Pause',
            0x333344,
            () => this.gameScene.togglePause()
        );

        // Upgrade button (hidden by default)
        this.upgradeButton = this.createActionButton(
            width - 60,
            bottomY + 15,
            'Upgrade ($0)',
            0x333366,
            () => this.onUpgradeClick()
        );
        this.upgradeButton.setVisible(false);

        // Sell button (hidden by default)
        this.sellButton = this.createActionButton(
            width - 170,
            bottomY + 15,
            'Sell ($0)',
            0x663333,
            () => this.onSellClick()
        );
        this.sellButton.setVisible(false);
    }

    createTowerButton(x: number, y: number, type: EmitterType): Phaser.GameObjects.Container {
        const def = EMITTER_DEFS[type];
        const container = this.add.container(x, y);

        // Background
        const bg = this.add.rectangle(0, 0, 46, 58, 0x222233, 0.9);
        bg.setStrokeStyle(2, 0x555566);
        container.add(bg);

        // Icon
        const icon = this.add.rectangle(0, -10, 22, 22, def.color);
        container.add(icon);

        // Cost text
        const costText = this.add.text(0, 16, `$${def.cost}`, {
            fontSize: '10px',
            fontFamily: 'Courier New, monospace',
            color: '#ffcc44',
        });
        costText.setOrigin(0.5);
        container.add(costText);

        // Key hint
        const keyMap = ['1', '2', '3', '4', '5', '6'];
        const typeIndex = ['water', 'fire', 'electric', 'goo', 'sniper', 'splash'].indexOf(type);
        const keyHint = this.add.text(0, -28, keyMap[typeIndex] || '', {
            fontSize: '10px',
            fontFamily: 'Courier New, monospace',
            color: '#888888',
        });
        keyHint.setOrigin(0.5);
        container.add(keyHint);

        // Make interactive
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            if (this.gameScene.state.gold >= def.cost) {
                bg.setStrokeStyle(2, 0xaaaaaa);
            }
        });
        bg.on('pointerout', () => {
            const isSelected = this.gameScene.state.selectedEmitterType === type;
            bg.setStrokeStyle(2, isSelected ? 0x4488ff : 0x555566);
        });
        bg.on('pointerdown', () => {
            this.gameScene.setSelectedEmitterType(type);
        });

        // Store references for updates
        (container as any).bg = bg;
        (container as any).type = type;

        return container;
    }

    createActionButton(
        x: number,
        y: number,
        text: string,
        color: number,
        onClick: () => void
    ): Phaser.GameObjects.Container {
        const container = this.add.container(x, y);

        const bg = this.add.rectangle(0, 0, 100, 28, color, 0.9);
        bg.setStrokeStyle(2, 0x666666);
        container.add(bg);

        const label = this.add.text(0, 0, text, {
            fontSize: '11px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
        });
        label.setOrigin(0.5);
        container.add(label);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(2, 0xaaaaaa));
        bg.on('pointerout', () => bg.setStrokeStyle(2, 0x666666));
        bg.on('pointerdown', onClick);

        (container as any).label = label;
        (container as any).bg = bg;

        return container;
    }

    createTowerInfoPanel(width: number, height: number) {
        this.towerInfoPanel = this.add.container(width / 2, height - UI_BOTTOM_HEIGHT - 30);
        this.towerInfoPanel.setVisible(false);

        const bg = this.add.rectangle(0, 0, 280, 35, 0x111122, 0.95);
        bg.setStrokeStyle(1, 0x555566);
        this.towerInfoPanel.add(bg);

        this.towerInfoName = this.add.text(-130, -8, '', {
            fontSize: '12px',
            fontFamily: 'Courier New, monospace',
            color: '#4488ff',
        });
        this.towerInfoPanel.add(this.towerInfoName);

        this.towerInfoLevel = this.add.text(-30, -8, '', {
            fontSize: '12px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
        });
        this.towerInfoPanel.add(this.towerInfoLevel);

        this.towerInfoStats = this.add.text(-130, 6, '', {
            fontSize: '10px',
            fontFamily: 'Courier New, monospace',
            color: '#aaaaaa',
        });
        this.towerInfoPanel.add(this.towerInfoStats);
    }

    createGameOverPanel(width: number, height: number) {
        this.gameOverPanel = this.add.container(width / 2, height / 2);
        this.gameOverPanel.setVisible(false);
        this.gameOverPanel.setDepth(100);

        // Dark overlay
        const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.85);
        this.gameOverPanel.add(overlay);

        // Title
        const title = this.add.text(0, -60, 'Game Over!', {
            fontSize: '42px',
            fontFamily: 'Courier New, monospace',
            color: '#ff4444',
        });
        title.setOrigin(0.5);
        this.gameOverPanel.add(title);

        // Final wave
        this.finalWaveText = this.add.text(0, 0, 'You survived 0 waves', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#aaaaaa',
        });
        this.finalWaveText.setOrigin(0.5);
        this.gameOverPanel.add(this.finalWaveText);

        // Restart button
        const restartBtn = this.createActionButton(0, 60, 'Play Again', 0x224422, () => {
            this.scene.stop('GameScene');
            this.scene.stop('UIScene');
            this.scene.start('GameScene');
        });
        this.gameOverPanel.add(restartBtn);
    }

    subscribeToEvents() {
        const gs = this.gameScene;

        gs.events.on('goldChanged', (gold: number) => {
            this.goldText.setText(`💰 ${gold}`);
            this.updateTowerButtons();
        });

        gs.events.on('healthChanged', (health: number) => {
            this.healthText.setText(`❤️ ${health}`);
        });

        gs.events.on('waveStarted', (wave: number) => {
            this.waveText.setText(`Wave: ${wave}`);
        });

        gs.events.on('waveComplete', (wave: number) => {
            this.updateTowerButtons();
        });

        gs.events.on('emitterTypeChanged', (type: EmitterType | null) => {
            this.updateTowerButtons();
        });

        gs.events.on('emitterSelected', (emitter: Emitter) => {
            this.showTowerInfo(emitter);
        });

        gs.events.on('emitterDeselected', () => {
            this.hideTowerInfo();
        });

        gs.events.on('emitterUpgraded', (emitter: Emitter) => {
            this.showTowerInfo(emitter);
        });

        gs.events.on('gameOver', (wave: number) => {
            const isNewHighScore = this.saveHighScore(wave);
            if (isNewHighScore) {
                this.finalWaveText.setText(`NEW HIGH SCORE!\nYou survived ${wave} waves`);
            } else {
                this.finalWaveText.setText(`You survived ${wave} waves`);
            }
            this.gameOverPanel.setVisible(true);
        });

        gs.events.on('pauseChanged', (isPaused: boolean) => {
            this.updatePauseButton(isPaused);
        });

        gs.events.on('insufficientFunds', () => {
            this.flashGold();
        });
    }

    flashGold() {
        this.goldFlashTimer = 0.5; // Flash for 0.5 seconds
    }

    updateHighScoreDisplay() {
        const highScore = this.getHighScore();
        if (highScore > 0) {
            this.highScoreText.setText(`Best: Wave ${highScore}`);
        } else {
            this.highScoreText.setText('');
        }
    }

    getHighScore(): number {
        try {
            const stored = localStorage.getItem('pixelclash_highscore');
            return stored ? parseInt(stored, 10) : 0;
        } catch {
            return 0;
        }
    }

    saveHighScore(wave: number) {
        try {
            const current = this.getHighScore();
            if (wave > current) {
                localStorage.setItem('pixelclash_highscore', wave.toString());
                this.updateHighScoreDisplay();
                return true; // New high score
            }
        } catch {
            // localStorage not available
        }
        return false;
    }

    updateUI() {
        const gs = this.gameScene;
        this.goldText.setText(`💰 ${gs.state.gold}`);
        this.healthText.setText(`❤️ ${gs.state.health}`);
        this.waveText.setText(`Wave: ${gs.state.wave}`);
        this.updateTowerButtons();
    }

    updateTowerButtons() {
        const gs = this.gameScene;

        this.towerButtons.forEach((container, type) => {
            const def = EMITTER_DEFS[type];
            const bg = (container as any).bg as Phaser.GameObjects.Rectangle;
            const canAfford = gs.state.gold >= def.cost;
            const isSelected = gs.state.selectedEmitterType === type;

            container.setAlpha(canAfford ? 1 : 0.4);
            bg.setStrokeStyle(2, isSelected ? 0x4488ff : 0x555566);

            if (isSelected) {
                bg.setFillStyle(0x334466, 0.9);
            } else {
                bg.setFillStyle(0x222233, 0.9);
            }
        });
    }

    updatePauseButton(isPaused: boolean) {
        const label = (this.pauseButton as any).label as Phaser.GameObjects.Text;
        const bg = (this.pauseButton as any).bg as Phaser.GameObjects.Rectangle;

        if (isPaused) {
            label.setText('▶ Play');
            bg.setFillStyle(0x224422, 0.9);
            this.pauseText.setText('⏸ PAUSED');
            this.pauseText.setColor('#ff6666');
        } else {
            label.setText('⏸ Pause');
            bg.setFillStyle(0x333344, 0.9);
            this.pauseText.setText('▶ AUTO');
            this.pauseText.setColor('#44ff44');
        }
    }

    showTowerInfo(emitter: Emitter) {
        const def = EMITTER_DEFS[emitter.data_.type];
        const mult = getUpgradeMultiplier(emitter.data_.level);

        const name = def.type.charAt(0).toUpperCase() + def.type.slice(1) + ' Emitter';
        this.towerInfoName.setText(name);
        this.towerInfoLevel.setText(`Lv.${emitter.data_.level + 1}`);
        this.towerInfoStats.setText(
            `DMG:${Math.round(def.damage * mult.damage)} ` +
            `RNG:${(def.range * mult.range).toFixed(1)} ` +
            `KB:${Math.round(def.knockbackForce * mult.knockback)}`
        );

        this.towerInfoPanel.setVisible(true);

        // Show upgrade button
        const upgCost = getUpgradeCost(emitter.data_.level);
        ((this.upgradeButton as any).label as Phaser.GameObjects.Text)
            .setText(`Upgrade ($${upgCost})`);
        this.upgradeButton.setVisible(true);

        // Show sell button
        const sellValue = emitter.getSellValue();
        ((this.sellButton as any).label as Phaser.GameObjects.Text)
            .setText(`Sell ($${sellValue})`);
        this.sellButton.setVisible(true);
    }

    hideTowerInfo() {
        this.towerInfoPanel.setVisible(false);
        this.upgradeButton.setVisible(false);
        this.sellButton.setVisible(false);
    }

    onUpgradeClick() {
        const gs = this.gameScene;
        if (gs.state.selectedEmitterId !== null) {
            gs.upgradeEmitter(gs.state.selectedEmitterId);
        }
    }

    onSellClick() {
        const gs = this.gameScene;
        if (gs.state.selectedEmitterId !== null) {
            gs.sellEmitter(gs.state.selectedEmitterId);
            this.hideTowerInfo();
        }
    }
}
