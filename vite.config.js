import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787'
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code from app code so redeploys only
        // invalidate the small app chunk (assets are cached immutable).
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('2.0.0')
  }
})
