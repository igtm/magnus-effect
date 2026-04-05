import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('three/examples')) {
            return 'three-examples'
          }

          if (id.includes('/three/')) {
            return 'three-core'
          }

          if (id.includes('solid-js')) {
            return 'solid-vendor'
          }
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
})
