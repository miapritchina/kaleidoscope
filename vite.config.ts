import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Which build this is, stamped in at build time and shown in the panel.
 *
 * A page served from a cache looks exactly like a fresh one, and the app is
 * mostly a picture — so "am I looking at the version I just deployed?" is not a
 * question the screen can otherwise answer. The commit is the useful half; the
 * date is what a person reads.
 *
 * Falls back rather than failing: a build from a tarball, or anywhere without
 * git, should still produce a working app.
 */
function stamp(): { commit: string; built: string } {
  let commit = 'unknown';

  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // No git, or no repository: the date below still says which build it is.
  }

  return { commit, built: new Date().toISOString() };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs, so the build works wherever it is served from: the
  // domain root, a project subpath like /kaleidoscope/ on GitHub Pages, or the
  // local preview. An absolute base would 404 under a subpath.
  base: './',
  define: {
    __BUILD__: JSON.stringify(stamp()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
