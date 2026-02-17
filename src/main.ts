import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config';

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#1a1a2e',
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            gravity: { x: 0, y: 0 },
        },
    },
    scene: [GameScene, UIScene],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
        pixelArt: false,
        antialias: true,
    },
};

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new Phaser.Game(config);
    });
} else {
    new Phaser.Game(config);
}
