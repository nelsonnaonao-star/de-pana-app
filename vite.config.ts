import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {sentryVitePlugin} from '@sentry/vite-plugin';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      sentryVitePlugin({
        org: 'red-on',
        project: 'javascript-react',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      esbuild: {
        drop: ['debugger'],
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@supabase') || id.includes('supabase-js')) return 'supabase';
              if (id.includes('@capacitor')) return 'capacitor';
              if (id.includes('lucide')) return 'lucide';
              if (id.includes('@sentry')) return 'sentry';
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
