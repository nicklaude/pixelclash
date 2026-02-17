import { Game } from './game';

let game: Game;
let lastTime = 0;

function init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    game = new Game(canvas);

    // Start game loop
    lastTime = performance.now();
    requestAnimationFrame(loop);
}

function loop(timestamp: number) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = timestamp;

    game.update(dt);
    game.renderer.render();

    requestAnimationFrame(loop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
