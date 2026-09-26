import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Proxy Google Maps APIs to bypass browser CORS constraints
      proxy: {
        '/api/gmaps/places': {
          target: 'https://places.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gmaps\/places/, ''),
        },
        '/api/gmaps/routes': {
          target: 'https://routes.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gmaps\/routes/, ''),
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
