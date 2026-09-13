import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
// Unified single-entry build that dynamically loads school/portal/static apps
// The root index.html detects subdomain client-side and imports the appropriate app

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
    // Optimize build
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    host: true,          // expose on all network interfaces → accessible from mobile on same WiFi
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    strictPort: !!process.env.PORT,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    // Default pool spins up one worker per CPU core and keeps every
    // jsdom environment for the whole run resident at once — on this
    // suite that meant 3GB+ and 40+ minutes for a single `vitest run`.
    // Capping forks bounds peak memory; see scripts/run-tests-phased.mjs
    // for splitting a run into smaller sequential batches too.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
      },
    },
  },
})
