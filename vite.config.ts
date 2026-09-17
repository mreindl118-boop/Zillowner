import { defineConfig } from 'vite'

// Served from GitHub Pages at https://<owner>.github.io/Zillowner/
export default defineConfig({
  base: '/Zillowner/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
