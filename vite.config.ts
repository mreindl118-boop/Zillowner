import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)

// MapLibre v6 loads its tile worker from a separate module resolved at
// runtime (new URL('./maplibre-gl-worker.mjs', import.meta.url)), which
// bundlers cannot see statically — the app calls setWorkerUrl() and this
// plugin ships the worker (and the shared chunk it imports) at the site root.
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

function maplibreWorker(): Plugin {
  const filePath = (name: string) => require.resolve(`maplibre-gl/dist/${name}`)
  return {
    name: 'costlab-maplibre-worker',
    generateBundle() {
      for (const name of MAPLIBRE_WORKER_FILES) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(filePath(name)) })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = MAPLIBRE_WORKER_FILES.find((n) => req.url?.endsWith(`/${n}`))
        if (!name) return next()
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(filePath(name)))
      })
    },
  }
}

// Served from GitHub Pages at https://<owner>.github.io/Zillowner/
export default defineConfig({
  base: '/Zillowner/',
  plugins: [maplibreWorker()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
