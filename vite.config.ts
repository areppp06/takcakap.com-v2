import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devHost = env.VITE_DEV_HOST || '0.0.0.0';
  const devPort = Number(env.VITE_DEV_PORT || 3000);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.PORT || 3001}`;
  const useDevProxy = String(env.VITE_USE_DEV_PROXY || 'true').toLowerCase() !== 'false';
  const allowedHosts = String(env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'script',
        manifest: {
          name: 'TakCakap',
          short_name: 'TakCakap',
          description: 'Full Stack Food Delivery App by DE WARISAN IBUNDA ENTERPRISE',
          theme_color: '#211120',
          background_color: '#f8f6f8',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    server: {
      host: devHost,
      port: devPort,
      allowedHosts: allowedHosts.length ? allowedHosts : true,
      proxy: useDevProxy
        ? {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  };
});
