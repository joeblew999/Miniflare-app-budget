import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// One Vite build for both halves: the React app (src/) and the Worker (worker/),
// run together in Cloudflare's workerd runtime during dev and preview.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    // Service worker: keeps the built app in the browser so it opens offline. Never caches /api/*.
    // Only in builds (app:build, app:preview, deploys); `app:dev` runs without it.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
})
