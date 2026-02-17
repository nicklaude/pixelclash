import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { Emitter } from '../objects/Emitter';
import { EmitterType } from '../types';
import { EMITTER_DEFS, getUpgradeCost, getUpgradeMultiplier } from '../config';

export class UIScene extends Phaser.Scene {
    gameScene!: GameScene;

    // UI Elements
    goldText!: Phaser.GameObjects.Text;
    healthText!: Phaser.GameObjects.Text;
    waveText!: Phaser.GameObjects.Text;

    towerButtons: Map<EmitterType, Phaser.GameObjects.Container> = new Map();
    startWaveButton!: Phaser.GameObjects.Container;
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
        const bg = this.add.rectangle(width / 2, 25, width, 50, 0x000000, 0.7);

        // Wave info
        this.waveText = this.add.text(20, 15, 'Wave: 0', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
        });

        // Health info
        this.healthText = this.add.text(150, 15, 'Health: 20', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ff6666',
        });

        // Gold info
        this.goldText = this.add.text(300, 15, 'Gold: 120', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            color: '#ffcc44',
        });
    }

    createBottomHUD(width: number, height: number) {
        // Background
        const bg = this.add.rectangle(width / 2, height - 50, width, 100, 0x000000, 0.8);

        // Tower buttons
        const towers: EmitterType[] = ['water', 'fire', 'electric', 'goo'];
        const buttonWidth = 60;
        const buttonHeight = 70;
        const startX = 30;

        towers.forEach((type, index) => {
            const x = startX + index * (buttonWidth + 10);
            const y = height - 50;
            const button = this.createTowerButton(x, y, type);
            this.towerButtons.set(type, button);
        });

        // Start wave button
        this.startWaveButton = this.createActionButton(
            width - 120,
            height - 60,
            'Start Wave',
            0x224422,
            () => this.gameScene.startWave()
        );

        // Upgrade button (hidden by default)
        this.upgradeButton = this.createActionButton(
            width - 120,
            height - 60,
            'Upgrade ($0)',
            0x333366,
            () => this.onUpgradeClick()
        );
        this.upgradeButton.setVisible(false);

        // Sell button (hidden by default)
        this.sellButton = this.createActionButton(
            width - 230,
            height - 60,
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
        const bg = this.add.rectangle(0, 0, 55, 65, 0x222222, 0.9);
        bg.setStrokeStyle(2, 0x555555);
        container.add(bg);

        // Icon
        const icon = this.add.rectangle(0, -12, 30, 30, def.color);
        container.add(icon);

        // Cost text
        const costText = this.add.text(0, 18, `$${def.cost}`, {
            fontSize: '11px',
            fontFamily: 'Courier New, monospace',
            color: '#ffcc44',
        });
        costText.setOrigin(0.5);
        container.add(costText);

        // Make interactive
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            if (this.gameScene.state.gold >= def.cost) {
                bg.setStrokeStyle(2, 0xaaaaaa);
            }
        });
        bg.on('pointerout', () => {
            const isSelected = this.gameScene.state.selectedEmitterType === type;
            bg.setStrokeStyle(2, isSelected ? 0x4488ff : 0x555555);
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

        const bg = this.add.rectangle(0, 0, 100, 35, color, 0.9);
        bg.setStrokeStyle(2, 0x666666);
        container.add(bg);

        const label = this.add.text(0, 0, text, {
            fontSize: '12px',
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
        this.towerInfoPanel = this.add.container(width / 2, height - 130);
        this.towerInfoPanel.setVisible(false);

        const bg = this.add.rectangle(0, 0, 300, 40, 0x111111, 0.95);
        bg.setStrokeStyle(1, 0x555555);
        this.towerInfoPanel.add(bg);

        this.towerInfoName = this.add.text(-140, -10, '', {
            fontSize: '13px',
            fontFamily: 'Courier New, monospace',
            color: '#4488ff',
        });
        this.towerInfoPanel.add(this.towerInfoName);

        this.towerInfoLevel = this.add.text(-40, -10, '', {
            fontSize: '13px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
        });
        this.towerInfoPanel.add(this.towerInfoLevel);

        this.towerInfoStats = this.add.text(-140, 5, '', {
            fontSize: '11px',
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
            fontSize: '48px',
            fontFamily: 'Courier New, monospace',
            color: '#ff4444',
        });
        title.setOrigin(0.5);
        this.gameOverPanel.add(title);

        // Final wave
        this.finalWaveText = this.add.text(0, 0, 'You survived 0 waves', {
            fontSize: '20px',
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
            this.goldText.setText(`Gold: ${gold}`);
            this.updateTowerButtons();
        });

        gs.events.on('healthChanged', (health: number) => {
            this.healthText.setText(`Health: ${health}`);
        });

        gs.events.on('waveStarted', (wave: number) => {
            this.waveText.setText(`Wave: ${wave}`);
            ((this.startWaveButton as any).label as Phaser.GameObjects.Text)
                .setText(`Wave ${wave}...`);
            ((this.startWaveButton as any).bg as Phaser.GameObjects.Rectangle)
                .setFillStyle(0x442222);
        });

        gs.events.on('waveComplete', (wave: number) => {
            ((this.startWaveButton as any).label as Phaser.GameObjects.Text)
                .setText('Start Wave');
            ((this.startWaveButton as any).bg as Phaser.GameObjects.Rectangle)
                .setFillStyle(0x224422);
            this.updateTowerButtons();
        });

        gs.events.on('emitterTypeChanged', (type: EmitterType | null) => {
            this.updateTowerButtons();
        });

        gs.events.on('emitterSelected', (emitter: Emitter) => {
            this.showTowerInfo(emitter);
            this.startWaveButton.setVisible(false);
        });

        gs.events.on('emitterDeselected', () => {
            this.hideTowerInfo();
            this.startWaveButton.setVisible(true);
        });

        gs.events.on('emitterUpgraded', (emitter: Emitter) => {
            this.showTowerInfo(emitter);
        });

        gs.events.on('gameOver', (wave: number) => {
            this.finalWaveText.setText(`You survived ${wave} waves`);
            this.gameOverPanel.setVisible(true);
        });
    }

    updateUI() {
        const gs = this.gameScene;
        this.goldText.setText(`Gold: ${gs.state.gold}`);
        this.healthText.setText(`Health: ${gs.state.health}`);
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
            bg.setStrokeStyle(2, isSelected ? 0x4488ff : 0x555555);

            if (isSelected) {
                bg.setFillStyle(0x334466, 0.9);
            } else {
                bg.setFillStyle(0x222222, 0.9);
            }
        });
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
            this.startWaveButton.setVisible(true);
        }
    }
}
