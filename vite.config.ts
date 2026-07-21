import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ollama': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
      '/ahrefs-api': {
        target: 'https://api.ahrefs.com/v3',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ahrefs-api/, ''),
      },
    },
  },
})
