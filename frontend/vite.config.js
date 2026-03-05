import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
// Multi-entry build: creates three separate apps
// - school: for school-specific subdomains (focus.kodereduai.pk)
// - portal: for super admin portal (portal.kodereduai.pk)
// - static: for landing page (www.kodereduai.pk)

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        school: resolve(__dirname, 'src/apps/school/main.html'),
        portal: resolve(__dirname, 'src/apps/portal/main.html'),
        static: resolve(__dirname, 'src/apps/static/main.html'),
      },
      output: {
        // Organize output by app
        dir: 'dist',
        entryFileNames: '[name]/[name].js',
        chunkFileNames: 'shared/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
    // Optimize build
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
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
  },
})
