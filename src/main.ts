import { Application } from 'pixi.js';
import { Game } from './Game';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config';

async function init() {
    const app = new Application();

    await app.init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: 0x1a1a2e,
        roundPixels: true,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
    });

    const container = document.getElementById('game-container');
    if (container) {
        container.appendChild(app.canvas);
    } else {
        document.body.appendChild(app.canvas);
    }

    const game = new Game(app);

    app.ticker.add((ticker) => {
        game.update(ticker.deltaMS / 1000);
    });
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
