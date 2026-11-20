// Bundles src/ into js/. The app is one entry; the Supabase client and the 3D viewer are split out and fetched only
// when they are needed, so the code gate loads fast. Built files are committed: GitHub Pages serves them as they are.
import { build, context } from 'esbuild';
import { rm, mkdir, copyFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: { app: 'src/main.js' },
  outdir: 'js',
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  minify: !watch,
  sourcemap: watch,
  target: ['es2020', 'safari15'],
  legalComments: 'none',
  logLevel: 'info',
};

await rm('js/chunks', { recursive: true, force: true });
await mkdir('js', { recursive: true });
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  // GitHub Pages serves 404.html for any address it has no file for, which is every space's address.
  await copyFile('index.html', '404.html');
}
