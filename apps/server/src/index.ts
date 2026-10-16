/**
 * CRDT Canvas server — one small process that:
 *   • serves the built web app (offline-capable PWA) with strict security headers,
 *   • relays WebRTC signaling for y-webrtc (pub/sub over WebSocket at /ws),
 *   • reports health at /health.
 *
 * It never sees board content: peers exchange encrypted CRDT updates directly,
 * and with an end-to-end key even the signaling messages are opaque.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, join, normalize, resolve, sep, dirname } from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

// ── Configuration ────────────────────────────────────────────────────────────

const env = process.env;
const here = dirname(fileURLToPath(import.meta.url));
export const config = {
  port: intEnv('PORT', 3001, 1, 65535),
  host: env.HOST || '0.0.0.0',
  production: env.NODE_ENV === 'production',
  staticDir: resolve(env.STATIC_DIR || join(here, '../../client/dist')),
  lanDiscovery: env.LAN_DISCOVERY ? env.LAN_DISCOVERY === 'true' : env.NODE_ENV !== 'production',
  maxConnections: intEnv('MAX_CONNECTIONS', 5000, 1, 1_000_000),
  maxTopicsPerPeer: intEnv('MAX_TOPICS_PER_PEER', 64, 1, 10_000),
  maxPeersPerTopic: intEnv('MAX_PEERS_PER_TOPIC', 256, 2, 100_000),
  maxMessageBytes: intEnv('MAX_MESSAGE_BYTES', 256 * 1024, 1024, 16 * 1024 * 1024),
  messagesPerSecond: intEnv('MESSAGES_PER_SECOND', 60, 1, 100_000),
  burst: intEnv('MESSAGE_BURST', 240, 1, 1_000_000),
  pingIntervalMs: intEnv('PING_INTERVAL_MS', 30_000, 1000, 600_000),
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`[server] ${name}=${raw} is invalid (expected ${min}–${max}); using ${fallback}.`);
    return fallback;
  }
  return value;
}

// ── Signaling state ──────────────────────────────────────────────────────────

interface Peer {
  ws: WebSocket;
  topics: Set<string>;
  tokens: number;
  lastRefill: number;
  alive: boolean;
}

const topics = new Map<string, Set<Peer>>();
const peers = new Set<Peer>();
const stats = { startedAt: Date.now(), messages: 0, dropped: 0 };

/** Room names are secrets; logs only ever show a short hash. */
const tag = (topic: string) => createHash('sha256').update(topic).digest('hex').slice(0, 8);

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(message)); } catch { /* socket closing */ }
}

function subscribe(peer: Peer, topic: string) {
  if (peer.topics.has(topic)) return;
  if (peer.topics.size >= config.maxTopicsPerPeer) return;
  let members = topics.get(topic);
  if (!members) { members = new Set(); topics.set(topic, members); }
  if (members.size >= config.maxPeersPerTopic) return;
  members.add(peer);
  peer.topics.add(topic);
  if (!config.production) console.log(`[signal] join ${tag(topic)} (${members.size})`);
}

function unsubscribe(peer: Peer, topic: string) {
  if (!peer.topics.delete(topic)) return;
  const members = topics.get(topic);
  if (!members) return;
  members.delete(peer);
  if (members.size === 0) topics.delete(topic);
}

function allow(peer: Peer): boolean {
  const now = Date.now();
  peer.tokens = Math.min(config.burst, peer.tokens + ((now - peer.lastRefill) / 1000) * config.messagesPerSecond);
  peer.lastRefill = now;
  if (peer.tokens < 1) return false;
  peer.tokens -= 1;
  return true;
}

const validTopic = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;

export function handleMessage(peer: Peer, message: unknown) {
  if (!message || typeof message !== 'object') return;
  const msg = message as { type?: unknown; topics?: unknown; topic?: unknown };
  switch (msg.type) {
    case 'subscribe':
      if (Array.isArray(msg.topics)) msg.topics.filter(validTopic).forEach(topic => subscribe(peer, topic));
      break;
    case 'unsubscribe':
      if (Array.isArray(msg.topics)) msg.topics.filter(validTopic).forEach(topic => unsubscribe(peer, topic));
      break;
    case 'publish': {
      if (!validTopic(msg.topic) || !peer.topics.has(msg.topic)) return;
      const receivers = topics.get(msg.topic);
      if (!receivers) return;
      const out = { ...(message as object), clients: receivers.size };
      for (const receiver of receivers) send(receiver.ws, out);
      break;
    }
    case 'ping':
      send(peer.ws, { type: 'pong' });
      break;
  }
}

// ── HTTP: static app, health, LAN discovery ─────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.map', '.txt']);

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
};

const fileCache = new Map<string, { body: Buffer; gzip: Buffer | null; etag: string; mtime: number }>();

function loadFile(path: string) {
  const stat = statSync(path);
  const cached = fileCache.get(path);
  if (cached && cached.mtime === stat.mtimeMs) return cached;
  const body = readFileSync(path);
  const entry = {
    body,
    gzip: COMPRESSIBLE.has(extname(path)) && body.length > 1024 ? gzipSync(body, { level: 9 }) : null,
    etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
    mtime: stat.mtimeMs,
  };
  fileCache.set(path, entry);
  return entry;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (!existsSync(config.staticDir)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const target = normalize(join(config.staticDir, decoded));
  // Path traversal guard.
  if (target !== config.staticDir && !target.startsWith(config.staticDir + sep)) return false;
  let file = target;
  let isFallback = false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(decoded)) return false; // a missing asset is a real 404
    file = join(config.staticDir, 'index.html'); // app routes live in the hash; serve the shell
    isFallback = true;
    if (!existsSync(file)) return false;
  }
  const entry = loadFile(file);
  const ext = extname(file);
  const immutable = !isFallback && /[\\/]assets[\\/]/.test(file);
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const gzip = entry.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (gzip) headers['Content-Encoding'] = 'gzip';
  const body = gzip ? entry.gzip! : entry.body;
  headers['Content-Length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('172.')) return entry.address;
    }
  }
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  }
  return null;
}

export const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  if (url.pathname === '/health') {
    json(res, 200, { status: 'ok', uptime: Math.round((Date.now() - stats.startedAt) / 1000), connections: peers.size, rooms: topics.size });
    return;
  }
  if (url.pathname === '/api/ip') {
    if (!config.lanDiscovery) { json(res, 404, { error: 'disabled' }); return; }
    const ip = lanAddress();
    json(res, 200, { ip, port: config.port });
    return;
  }
  if (serveStatic(req, res, url.pathname)) return;
  json(res, 404, { error: 'Not found' });
});

// ── WebSocket signaling ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes, perMessageDeflate: false });

httpServer.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname !== '/ws' && pathname !== '/') { socket.destroy(); return; }
  if (peers.size >= config.maxConnections) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

wss.on('connection', (ws: WebSocket) => {
  const peer: Peer = { ws, topics: new Set(), tokens: config.burst, lastRefill: Date.now(), alive: true };
  peers.add(peer);
  ws.on('pong', () => { peer.alive = true; });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    stats.messages++;
    if (!allow(peer)) { stats.dropped++; return; }
    let message: unknown;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(peer, message);
  });
  const close = () => {
    for (const topic of [...peer.topics]) unsubscribe(peer, topic);
    peers.delete(peer);
  };
  ws.on('close', close);
  ws.on('error', close);
});

const heartbeat = setInterval(() => {
  for (const peer of peers) {
    if (!peer.alive) { peer.ws.terminate(); continue; }
    peer.alive = false;
    try { peer.ws.ping(); } catch { /* closing */ }
  }
}, config.pingIntervalMs);
heartbeat.unref();

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function start(port = config.port): Promise<number> {
  return new Promise(resolvePort => {
    httpServer.listen(port, config.host, () => {
      const address = httpServer.address();
      resolvePort(typeof address === 'object' && address ? address.port : port);
    });
  });
}

export function stop(): Promise<void> {
  clearInterval(heartbeat);
  for (const peer of peers) peer.ws.close(1001, 'Server shutting down');
  return new Promise(done => {
    wss.close();
    httpServer.close(() => done());
    setTimeout(done, 3000).unref();
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void start().then(port => {
    const app = existsSync(join(config.staticDir, 'index.html'));
    const lan = config.lanDiscovery ? lanAddress() : null;
    console.log(`[server] CRDT Canvas listening on http://localhost:${port}${lan ? `  (LAN: http://${lan}:${port})` : ''}`);
    console.log(`[server] signaling at ws://localhost:${port}/ws · ${app ? `serving app from ${config.staticDir}` : 'no built app found (run the client build, or use the Vite dev server)'}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[server] ${signal}: shutting down`);
      void stop().then(() => process.exit(0));
    });
  }
}
