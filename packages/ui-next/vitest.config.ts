import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const resolveFromRoot = (relativePath: string) => path.resolve(rootDir, relativePath);

/**
 * Vitest is configured standalone rather than merged into `vite.config.ts` so the
 * production bundle never pays for test-only plugins, and so `vitest` can be run
 * from the repository root without loading the Tailwind pipeline.
 *
 * `environment` defaults to `jsdom` because the majority of the suite touches React
 * or browser globals. Pure-logic suites opt out per file with:
 *   // @vitest-environment node
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolveFromRoot('./src'),
    },
  },
  test: {
    // Explicit `import { describe, it, expect } from 'vitest'` is preferred over
    // globals: it keeps the type surface honest and matches upstream guidance.
    globals: false,
    environment: 'jsdom',
    setupFiles: [resolveFromRoot('./test/setup.ts')],
    include: ['test/**/*.{test,spec}.{ts,tsx,mts,mjs,js}'],
    exclude: ['**/node_modules/**', '**/public/**', '**/dist/**'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: resolveFromRoot('./test-results/junit.xml'),
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: resolveFromRoot('./coverage'),
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', '*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/routes/**',
        'src/components/ui/**',
        'vite.config.ts',
        'vitest.config.ts',
        '**/node_modules/**',
        'public/**',
      ],
      // Ratcheted thresholds: raise these as coverage grows, never lower them.
      thresholds: {
        lines: 25,
        functions: 35,
        branches: 60,
        statements: 25,
      },
    },
  },
});
