import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo-coe.png'],
      manifest: {
        name: 'COE Zapopan — Sistema de Emergencias',
        short_name: 'COE Zapopan',
        description:
          'Sistema de gestión de emergencias de la Coordinación Municipal de Protección Civil y Bomberos Zapopan',
        theme_color: '#dc2626',
        background_color: '#0f0f0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'logo-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Caché de la API para modo offline parcial
            urlPattern: /^https?:\/\/.*\/api\/catalogos\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'catalogos-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 }, // 24h
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
