/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API is reached through the dev server, so no CORS setup is needed.
    proxy: { '/api': { target: process.env.VITE_DEV_API ?? 'http://localhost:5001', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
