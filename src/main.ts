import { Application } from 'pixi.js';
import { Game } from './Game';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config';

async function init() {
    const app = new Application();

    // Calculate scale to fit screen
    const container = document.getElementById('game-container');
    const maxWidth = window.innerWidth - 20;
    const maxHeight = window.innerHeight - 100;

    // Calculate scale factor to fit game on screen
    const scaleX = maxWidth / CANVAS_WIDTH;
    const scaleY = maxHeight / CANVAS_HEIGHT;
    const scale = Math.min(scaleX, scaleY, 1); // Never scale up, only down

    const scaledWidth = Math.floor(CANVAS_WIDTH * scale);
    const scaledHeight = Math.floor(CANVAS_HEIGHT * scale);

    await app.init({
        width: scaledWidth,
        height: scaledHeight,
        backgroundColor: 0x1a1a2e,
        roundPixels: true,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
    });

    // Scale the stage to match our game coordinates
    app.stage.scale.set(scale);

    if (container) {
        container.appendChild(app.canvas);
    } else {
        document.body.appendChild(app.canvas);
    }

    // Store scale for coordinate conversion
    (app as any).gameScale = scale;

    const game = new Game(app);

    app.ticker.add((ticker) => {
        game.update(ticker.deltaMS / 1000);
    });

    // Handle resize
    window.addEventListener('resize', () => {
        const newMaxWidth = window.innerWidth - 20;
        const newMaxHeight = window.innerHeight - 100;
        const newScaleX = newMaxWidth / CANVAS_WIDTH;
        const newScaleY = newMaxHeight / CANVAS_HEIGHT;
        const newScale = Math.min(newScaleX, newScaleY, 1);

        app.renderer.resize(
            Math.floor(CANVAS_WIDTH * newScale),
            Math.floor(CANVAS_HEIGHT * newScale)
        );
        app.stage.scale.set(newScale);
        (app as any).gameScale = newScale;
    });
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
