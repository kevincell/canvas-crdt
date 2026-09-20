/**
 * CRDT Canvas Signaling Server
 *
 * HTTP API (port 3001):
 *   GET  /api/ip        — returns local LAN IP for WiFi peer discovery
 *   GET  /api/room/:id  — room presence info
 *   GET  /health        — health check
 *
 * WebSocket (port 3001, path /ws and /):
 *   Fully compliant with y-webrtc signaling protocol (subscribe, unsubscribe, publish, ping/pong).
 *   Used for WebRTC peer discovery only. No canvas data is stored on this server.
 */

import { createServer, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const _name of Object.keys(nets)) {
    const iface = nets[_name] ?? [];
    for (const entry of iface) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return '127.0.0.1';
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

const httpServer = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/ip' && req.method === 'GET') {
    const ip = getLocalIP();
    sendJSON(res, 200, {
      ip,
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

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJSON(res, 200, { status: 'ok', rooms: rooms.size, peers: peers.size });
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

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

httpServer.listen(PORT, () => {
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
