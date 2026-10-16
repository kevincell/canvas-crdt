import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Emits `sw.js` with the exact list of built files, so the installed app shell
 * (and every lazy chunk) is cached on first visit and works fully offline.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'crdt-canvas-offline-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(name => !name.endsWith('.map') && name !== 'sw.js');
      const statics = ['./', 'index.html', 'manifest.webmanifest', 'node-globals.js', 'icon.svg', 'icon-192.png', 'icon-512.png'];
      const precache = [...new Set([...statics, ...files])];
      const version = createHash('sha256').update(precache.join('|') + Object.values(bundle).map(item => 'code' in item ? item.code.length : 0).join(',')).digest('hex').slice(0, 12);
      const template = readFileSync(resolve(__dirname, 'sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  define: process.env.VITEST ? {
    global: 'globalThis',
  } : {
    // Node globals expected by simple-peer (used by y-webrtc).
    global: 'globalThis',
    'process.env': '{}',
    'process.version': '"v20.0.0"',
    'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      // Use the engine's TypeScript source directly: no stale dist builds.
      '@crdt-canvas/engine': resolve(__dirname, '../../packages/engine/src/index.ts'),
      // Redirect y-webrtc's UMD import to our local ESM wrapper.
      'simple-peer/simplepeer.min.js': resolve(__dirname, 'src/simple-peer-wrapper.ts'),
      events: 'events',
      util: resolve(__dirname, 'src/polyfills/util.ts'),
      buffer: 'buffer',
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
      path: 'path-browserify',
      url: 'url',
      assert: 'assert',
      constants: 'constants-browserify',
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001' },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3001' },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  optimizeDeps: {
    include: ['simple-peer', 'events', 'buffer', 'stream-browserify', 'crypto-browserify', 'path-browserify', 'url', 'assert'],
    esbuildOptions: { define: { global: 'globalThis' } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](yjs|y-protocols|y-indexeddb|lib0)[\\/]/.test(id)) return 'crdt';
          if (/[\\/](y-webrtc|simple-peer|readable-stream|stream-browserify|crypto-browserify|buffer|events|browserify|bn\.js|elliptic|asn1|create-hash|create-hmac|cipher-base|des\.js|diffie-hellman|parse-asn1|public-encrypt|randombytes|randomfill|hash-base|md5\.js|ripemd160|sha\.js|pbkdf2|evp_bytestokey)/.test(id)) return 'p2p';
          if (/[\\/](@mui|@emotion|react-transition-group|@popperjs)[\\/]/.test(id)) return 'mui';
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](roughjs|perfect-freehand|qrcode-generator)[\\/]/.test(id)) return 'draw';
          return undefined;
        },
      },
    },
  },
});
