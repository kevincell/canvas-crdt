/**
 * CRDT Canvas Signaling Server
 *
 * HTTP API (port 3001):
 *   GET  /api/ip        — returns local LAN IP for WiFi peer discovery
 *   GET  /api/room/:id  — room presence info
 *   GET  /health        — health check
 *   GET  /api/time      — server clock (watch-party clock sync)
 *   POST /api/media/upload — upload a local audio/video/subtitle file (raw body, X-Filename header)
 *   GET  /api/media/:id    — stream an uploaded file (HTTP Range support for seeking)
 *
 * WebSocket (port 3001, path /ws and /):
 *   Fully compliant with y-webrtc signaling protocol (subscribe, unsubscribe, publish, ping/pong).
 *   Used for WebRTC peer discovery only. No canvas data is stored on this server.
 */

import { createServer, type ServerResponse, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';
import { stat as fsStat, unlink, readdir } from 'fs/promises';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Types ────────────────────────────────────────────────────────────────────

type Peer = {
  id: string;
  ws: WebSocket;
  rooms: Set<string>;
  name?: string;
  connectedAt: number;
};

type Room = {
  id: string;
  peers: Map<string, Peer>;
  createdAt: number;
};

// ── State ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[signaler] Invalid PORT env var: ${process.env.PORT ?? 'unset'}. Defaulting to 3001.`);
  process.exit(1);
}
const peers = new Map<WebSocket, Peer>();
const rooms = new Map<string, Room>();

// ── Media Uploads ────────────────────────────────────────────────────────────

// This package is ESM ("type": "module"), so __dirname does not exist — derive it.
// Resolves to apps/server/uploads from both src/ (tsx) and dist/ (node).
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(SERVER_DIR, '..', 'uploads');
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const UPLOAD_IDLE_TTL_MS = 6 * 60 * 60 * 1000; // delete files nobody has streamed for 6 hours

// Upload metadata (original filename + last time a peer streamed it)
const uploadMeta = new Map<string, { createdAt: number; lastAccess: number; filename: string }>();

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
};

const ALLOWED_EXTS = new Set(Object.keys(MIME_TYPES));

// Auto-cleanup: scans the folder (so files left over from a previous run are cleaned too)
// and only removes files that nobody has streamed recently — a long movie is never deleted mid-party.
async function cleanupUploads() {
  const now = Date.now();
  let entries: string[] = [];
  try {
    entries = await readdir(UPLOADS_DIR);
  } catch {
    return;
  }
  for (const id of entries) {
    const filepath = join(UPLOADS_DIR, id);
    try {
      const stats = await fsStat(filepath);
      if (!stats.isFile()) continue;
      const lastUsed = Math.max(stats.mtimeMs, uploadMeta.get(id)?.lastAccess ?? 0);
      if (now - lastUsed > UPLOAD_IDLE_TTL_MS) {
        await unlink(filepath);
        console.log(`[media] Auto-cleaned idle upload: ${uploadMeta.get(id)?.filename ?? id}`);
        uploadMeta.delete(id);
      }
    } catch { /* file busy or already gone — try again next round */ }
  }
}
cleanupUploads();
setInterval(cleanupUploads, 15 * 60 * 1000); // Check every 15 minutes

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLanIPs(): string[] {
  const ignored = /^(lo|docker|br-|veth|virbr|zt|tailscale)/i;
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (ignored.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) candidates.push({ name, address: entry.address });
    }
  }
  // Prefer ordinary wired/wireless adapters. LAN_IP remains available for hosts
  // with several active networks or a nonstandard adapter name.
  return candidates.sort((a, b) => Number(!/^(en|eth|wl|wi)/i.test(a.name)) - Number(!/^(en|eth|wl|wi)/i.test(b.name))).map(c => c.address);
}

function getLocalIP(): string {
  return process.env.LAN_IP?.trim() || getLanIPs()[0] || '127.0.0.1';
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Filename, Range',
  });
  res.end(JSON.stringify(data));
}

function safeSend(ws: WebSocket, message: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* socket error */
    }
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Filename, Range',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/ip' && req.method === 'GET') {
    const ip = getLocalIP();
    sendJSON(res, 200, {
      ip,
      ips: getLanIPs(),
      port: PORT,
      signalingUrl: `ws://${ip}:${PORT}/ws`,
      hint: 'Set VITE_SIGNALING_URL=ws://<this-ip>:3001/ws on the other device',
    });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/room\/(.+)$/);
  if (roomMatch && req.method === 'GET') {
    const roomId = decodeURIComponent(roomMatch[1]);
    const room = rooms.get(roomId);
    if (!room) {
      sendJSON(res, 404, { error: 'Room not found', roomId, peerCount: 0, peers: [] });
      return;
    }
    sendJSON(res, 200, {
      roomId,
      peerCount: room.peers.size,
      peers: Array.from(room.peers.values()).map(p => ({
        id: p.id.slice(0, 6),
        name: p.name || 'Anonymous',
      })),
    });
    return;
  }

  // Shared clock for watch-party sync (peers estimate their offset to this)
  if (url.pathname === '/api/time' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ now: Date.now() }));
    return;
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJSON(res, 200, { status: 'ok', rooms: rooms.size, peers: peers.size });
    return;
  }

  // ── File Upload Endpoint ──────────────────────────────────────────────────
  // Body is the raw file bytes. Streamed straight to disk so a 500 MB movie
  // never has to fit in RAM. Filename arrives URI-encoded in X-Filename.
  if (url.pathname === '/api/media/upload' && req.method === 'POST') {
    handleUpload(req, res);
    return;
  }

  // ── File Serve Endpoint (with Range support for seeking) ──────────────────
  const mediaMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (mediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    await handleMediaServe(req, res, decodeURIComponent(mediaMatch[1]));
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

// ── Media handlers ───────────────────────────────────────────────────────────

function handleUpload(req: IncomingMessage, res: ServerResponse) {
  let originalName = `upload-${Date.now()}`;
  const header = req.headers['x-filename'];
  if (typeof header === 'string' && header.trim()) {
    try {
      originalName = decodeURIComponent(header);
    } catch {
      originalName = header;
    }
  }
  // Strip any path components a client might send
  originalName = originalName.split(/[\\/]/).pop() || originalName;

  const ext = extname(originalName).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    req.resume();
    sendJSON(res, 415, { error: `Unsupported file type "${ext || 'none'}". Use audio/video files (mp3, mp4, webm, mkv, …) or .vtt subtitles.` });
    return;
  }

  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > MAX_UPLOAD_BYTES) {
    req.resume();
    sendJSON(res, 413, { error: 'File too large (max 500 MB)' });
    return;
  }

  const fileId = `${randomUUID()}${ext}`;
  const filepath = join(UPLOADS_DIR, fileId);
  const out = createWriteStream(filepath);
  let totalSize = 0;
  let finished = false;

  const fail = (status: number, message: string) => {
    if (finished) return;
    finished = true;
    out.destroy();
    unlink(filepath).catch(() => { /* ignore */ });
    if (!res.headersSent) sendJSON(res, status, { error: message });
  };

  req.on('data', (chunk: Buffer) => {
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD_BYTES) {
      fail(413, 'File too large (max 500 MB)');
      req.destroy();
    }
  });
  req.on('aborted', () => fail(400, 'Upload aborted'));
  req.on('error', () => fail(500, 'Upload stream error'));
  out.on('error', (err) => {
    console.error('[media] Upload write error:', err);
    fail(500, 'Upload failed (could not write file)');
  });
  out.on('finish', () => {
    if (finished) return;
    finished = true;
    const now = Date.now();
    uploadMeta.set(fileId, { createdAt: now, lastAccess: now, filename: originalName });
    const ip = getLocalIP();
    console.log(`[media] Uploaded: ${originalName} (${(totalSize / 1024 / 1024).toFixed(1)} MB) → ${fileId}`);
    sendJSON(res, 200, {
      id: fileId,
      // Relative path: each peer resolves it against its own route to this server.
      path: `/api/media/${fileId}`,
      url: `http://${ip}:${PORT}/api/media/${fileId}`,
      filename: originalName,
      size: totalSize,
    });
  });

  req.pipe(out);
}

async function handleMediaServe(req: IncomingMessage, res: ServerResponse, fileId: string) {
  // Security: only plain generated file names, no path traversal
  if (!/^[\w-]+\.[\w]+$/.test(fileId)) {
    sendJSON(res, 400, { error: 'Invalid file ID' });
    return;
  }

  const filepath = join(UPLOADS_DIR, fileId);
  let size: number;
  try {
    const stats = await fsStat(filepath);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    sendJSON(res, 404, { error: 'File not found (it may have been cleaned up — upload it again)' });
    return;
  }

  const meta = uploadMeta.get(fileId);
  if (meta) meta.lastAccess = Date.now();
  else uploadMeta.set(fileId, { createdAt: Date.now(), lastAccess: Date.now(), filename: fileId });

  const mimeType = MIME_TYPES[extname(fileId).toLowerCase()] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cache-Control': 'no-cache',
  };

  const range = req.headers.range;
  if (range && size > 0) {
    // Supports "bytes=start-end", "bytes=start-" and suffix "bytes=-N"
    const m = /^bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = size - 1;
    if (m) {
      if (m[1] === '' && m[2] !== '') {
        start = Math.max(0, size - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1] || '0', 10);
        if (m[2] !== '') end = Math.min(size - 1, parseInt(m[2], 10));
      }
    }
    if (!m || isNaN(start) || isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(filepath, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(filepath);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ── WebSocket Server (y-webrtc pub/sub signaling) ────────────────────────────

const wsServer = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, (ws) => {
    wsServer.emit('connection', ws, request);
  });
});

wsServer.on('connection', (socket: WebSocket, req) => {
  const peerId = randomUUID();
  const peer: Peer = {
    id: peerId,
    ws: socket,
    rooms: new Set(),
    connectedAt: Date.now(),
  };
  peers.set(socket, peer);

  // Check URL query parameters in case client connected with ?roomId=...
  try {
    const params = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`).searchParams;
    const initialRoom = params.get('roomId') || params.get('room');
    const initialName = params.get('name');
    if (initialName) peer.name = initialName;
    if (initialRoom) subscribePeerToRoom(peer, initialRoom);
  } catch {
    /* ignore malformed url */
  }

  let isAlive = true;
  socket.on('pong', () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      clearInterval(pingInterval);
      socket.terminate();
      return;
    }
    isAlive = false;
    socket.ping();
  }, 30000);

  socket.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      handleMessage(peer, msg);
    } catch {
      /* ignore invalid JSON */
    }
  });

  const cleanup = () => {
    clearInterval(pingInterval);
    handlePeerDisconnect(peer);
  };

  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

function subscribePeerToRoom(peer: Peer, roomId: string) {
  if (peer.rooms.has(roomId)) return;
  peer.rooms.add(roomId);

  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: new Map(), createdAt: Date.now() };
    rooms.set(roomId, room);
  }
  room.peers.set(peer.id, peer);

  const displayName = peer.name ? `"${peer.name}" (${peer.id.slice(0, 6)})` : `(${peer.id.slice(0, 6)})`;
  console.log(`[signaler] ${displayName} joined room ${roomId} — ${room.peers.size} peers`);
}

function unsubscribePeerFromRoom(peer: Peer, roomId: string) {
  if (!peer.rooms.has(roomId)) return;
  peer.rooms.delete(roomId);

  const room = rooms.get(roomId);
  if (room) {
    room.peers.delete(peer.id);
    const displayName = peer.name ? `"${peer.name}" (${peer.id.slice(0, 6)})` : `(${peer.id.slice(0, 6)})`;
    console.log(`[signaler] ${displayName} left room ${roomId} — ${room.peers.size} remaining`);
    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  }
}

function handlePeerDisconnect(peer: Peer) {
  for (const roomId of peer.rooms) {
    unsubscribePeerFromRoom(peer, roomId);
  }
  peer.rooms.clear();
  peers.delete(peer.ws);
}

function handleMessage(peer: Peer, msg: any) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'subscribe': {
      const topics = Array.isArray(msg.topics) ? msg.topics : (msg.topic ? [msg.topic] : []);
      for (const topic of topics) {
        if (typeof topic === 'string') {
          subscribePeerToRoom(peer, topic);
        }
      }
      break;
    }

    case 'unsubscribe': {
      const topics = Array.isArray(msg.topics) ? msg.topics : (msg.topic ? [msg.topic] : []);
      for (const topic of topics) {
        if (typeof topic === 'string') {
          unsubscribePeerFromRoom(peer, topic);
        }
      }
      break;
    }

    case 'publish': {
      const topic = msg.topic;
      if (!topic || typeof topic !== 'string') return;

      const room = rooms.get(topic);
      if (!room) return;

      // Make sure sender is registered in room
      if (!peer.rooms.has(topic)) {
        subscribePeerToRoom(peer, topic);
      }

      // Check payload for logging WebRTC handshake signals
      const data = msg.data;
      if (data && typeof data === 'object') {
        if (data.type === 'signal') {
          console.log(`[signaler] Peer-to-peer WebRTC offer/answer/ice-candidate exchanged in room ${topic}`);
        }
      }

      // Forward publish message to all other peers in the room
      const receivers = Array.from(room.peers.values()).filter(p => p.id !== peer.id);
      msg.clients = receivers.length;

      for (const receiver of receivers) {
        safeSend(receiver.ws, msg);
      }
      break;
    }

    case 'ping': {
      safeSend(peer.ws, { type: 'pong' });
      break;
    }

    // Support legacy signal payloads if sent directly
    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      console.log(`[signaler] Peer-to-peer WebRTC offer/answer/ice-candidate exchanged`);
      for (const roomId of peer.rooms) {
        const room = rooms.get(roomId);
        if (room) {
          for (const [id, target] of room.peers) {
            if (id !== peer.id) {
              safeSend(target.ws, { ...msg, fromPeerId: peer.id });
            }
          }
        }
      }
      break;
    }
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  ┌──────────────────────────────────────────────────┐`);
  console.log(`  │  CRDT Canvas Signaling Server                    │`);
  console.log(`  │                                                  │`);
  console.log(`  │  HTTP:    http://localhost:${PORT}                │`);
  console.log(`  │  WS:      ws://localhost:${PORT}/ws              │`);
  console.log(`  │  LAN IP:  ${ip}                                 │`);
  console.log(`  │                                                  │`);
  console.log(`  │  To connect from another device on same WiFi:    │`);
  console.log(`  │  1. Set VITE_SIGNALING_URL=ws://${ip}:${PORT}/ws │`);
  console.log(`  │  2. Use the same room ID on both devices         │`);
  console.log(`  └──────────────────────────────────────────────────┘\n`);
});

process.on('SIGINT', () => {
  console.log('\n[signaler] Shutting down...');
  wsServer.close();
  httpServer.close();
  process.exit(0);
});
