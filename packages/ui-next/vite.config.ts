import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const releaseCommit = process.env.KRYPTON_UI_BUILD_COMMIT;
const releaseOutput = process.env.KRYPTON_UI_BUILD_OUTPUT;
if (releaseCommit !== undefined || releaseOutput !== undefined) {
  if (!releaseCommit || !/^[0-9a-f]{40}$/.test(releaseCommit) || !releaseOutput || !path.isAbsolute(releaseOutput)) {
    throw new Error('UINext release build requires a full commit SHA and an absolute output directory');
  }
}
const outDir = releaseOutput ?? path.resolve(rootDir, './public/next');

export default defineConfig({
  root: rootDir,
  base: releaseCommit ? `/next/releases/${releaseCommit}/` : '/next/',
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'pdf-reader-assets',
      apply: 'build',
      closeBundle() {
        for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
          fs.cpSync(path.join(rootDir, 'node_modules/pdfjs-dist', directory), path.join(outDir, directory), { recursive: true });
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  build: {
    manifest: 'manifest.json',
    outDir,
    emptyOutDir: !releaseCommit,
  },
});
