import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
  ],
  define: process.env.VITEST ? {
    global: 'globalThis',
  } : {
    // Polyfill Node.js globals
    global: 'globalThis',
    'process.env': '{}',
    'process.version': '"v20.0.0"',
    'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      // Redirect y-webrtc's UMD import to our local ESM wrapper.
      // The wrapper re-exports `simple-peer` (CJS) as an ES module default.
      'simple-peer/simplepeer.min.js': resolve(__dirname, 'src/simple-peer-wrapper.ts'),
      // Polyfill Node.js built-ins
      events: 'events',
      util: resolve(__dirname, 'src/polyfills/util.ts'),
      buffer: 'buffer',
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
      path: 'path-browserify',
      fs: 'memfs',
      os: 'os-browserify/browser',
      url: 'url',
      assert: 'assert',
      constants: 'constants-browserify',
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: {
      allow: [
        __dirname,
        resolve(__dirname, 'node_modules'),
        resolve(__dirname, '../..', 'node_modules'),
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle simple-peer so Vite transforms CJS → ESM.
    include: ['simple-peer', 'events', 'buffer', 'stream-browserify', 'crypto-browserify', 'path-browserify', 'url', 'assert', 'constants-browserify'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
