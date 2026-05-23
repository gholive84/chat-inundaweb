import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icone-chat.png', 'inunda-chat.png', 'icone-chat-192.png', 'icone-chat-512.png', 'icone-chat-192-maskable.png', 'icone-chat-512-maskable.png'],
      manifest: {
        name: 'Chat Inunda',
        short_name: 'Chat Inunda',
        description: 'Atendimento WhatsApp com IA',
        theme_color: '#0A1628',
        background_color: '#0A1628',
        display: 'standalone',
        start_url: '/app/chat',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icone-chat-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icone-chat-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icone-chat-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icone-chat-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api':      { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist' },
});
