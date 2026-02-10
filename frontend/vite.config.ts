import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5012,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  }
})
