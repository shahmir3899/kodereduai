import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import fs from 'fs'

// Guide videos live outside the app (repo media/guide, hosted on the media subdomain in production) so they never
// bloat the build. In dev, serve that folder at /guide so recording and previewing work with no env set up.
const MEDIA_DIR = resolve(__dirname, '../media/guide')
const TYPES = { '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.jpg': 'image/jpeg' }
const serveGuideMedia = () => ({
  name: 'serve-guide-media',
  configureServer(server) {
    server.middlewares.use('/guide', (req, res, next) => {
      const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '')
      const file = resolve(MEDIA_DIR, name)
      if (!file.startsWith(MEDIA_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
      const size = fs.statSync(file).size
      const ext = file.slice(file.lastIndexOf('.'))
      res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
      if (!m) {
        res.setHeader('Content-Length', size)
        return fs.createReadStream(file).pipe(res)
      }
      const start = m[1] ? Number(m[1]) : size - Number(m[2])
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', end - start + 1)
      return fs.createReadStream(file, { start, end }).pipe(res)
    })
  },
})

// https://vite.dev/config/
// Unified single-entry build that dynamically loads school/portal/static apps
// The root index.html detects subdomain client-side and imports the appropriate app

export default defineConfig({
  plugins: [react(), serveGuideMedia()],
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
