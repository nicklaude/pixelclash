const esbuild = require('esbuild');
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Update version in index.html
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/(id="version-info">v)[^<]*/, `$1${pkg.version}`);
fs.writeFileSync('index.html', html);

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  format: 'iife',
  globalName: 'PixelClash',
  target: 'es2020',
  sourcemap: true,
  minify: !isWatch,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  },
  external: ['three'],
  // THREE.js loaded from CDN as global
};

if (isWatch) {
  esbuild.context(buildOptions).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log(`Built PixelClash v${pkg.version}`);
  });
}
