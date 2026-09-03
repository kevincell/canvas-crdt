/**
 * CRDT Canvas Signaling Server
 *
 * HTTP API (port 3001):
 *   GET  /api/ip        — returns local LAN IP for WiFi peer discovery
 *   GET  /api/room/:id  — room presence info
 *   GET  /health        — health check
 *
 * WebSocket (port 3001, path /ws):
 *   Used by y-webrtc for WebRTC peer discovery only.
 *   No canvas data passes through this server.
 *
 * To connect two devices on the same WiFi:
 *   1. Start this server:  pnpm --filter @crdt-canvas/server dev
 *   2. Note the LAN IP shown in the console
 *   3. On device 2, set:  VITE_SIGNALING_URL=ws://<LAN-IP>:3001
 *   4. Both devices use the same room ID
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

type Peer = {
  id: string;
  ws: WebSocket;
  roomId: string;
  name: string;
  connectedAt: number;
};

type Room = {
  id: string;
  peers: Map<string, Peer>;
  createdAt: number;
};

// ── State ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001');
const peers = new Map<string, Peer>();
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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/ip' && req.method === 'GET') {
    sendJSON(res, 200, {
      ip: getLocalIP(),
      port: PORT,
      signalingUrl: `ws://${getLocalIP()}:${PORT}`,
      hint: 'Set VITE_SIGNALING_URL=ws://<this-ip>:3001 on the other device',
    });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/room\/(.+)$/);
  if (roomMatch && req.method === 'GET') {
    const roomId = decodeURIComponent(roomMatch[1]);
    const room = rooms.get(roomId);
    if (!room) { sendJSON(res, 404, { error: 'Room not found' }); return; }
    sendJSON(res, 200, {
      roomId,
      peerCount: room.peers.size,
      peers: Array.from(room.peers.values()).map(p => ({
        id: p.id.slice(0, 6),
        name: p.name,
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

// ── WebSocket Server (y-webrtc signaling) ────────────────────────────────────

const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });

wsServer.on('connection', (socket, req) => {
  const params = new URL(req.url ?? '', `http://${req.headers.host}`).searchParams;
  const action = params.get('action');
  const roomId = params.get('roomId');
  const name = params.get('name') ?? 'Anonymous';

  if (action === 'join' && roomId) {
    handleJoin(socket, roomId, name);
    return;
  }

  if (action === 'create') {
    const newRoomId = randomUUID().slice(0, 8);
    handleJoin(socket, newRoomId, name);
    socket.send(JSON.stringify({ type: 'room-created', roomId: newRoomId }));
    return;
  }

  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleSignal(socket, msg);
    } catch { /* ignore */ }
  });

  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', () => handleDisconnect(socket));
});

// ── Room / Peer Logic ────────────────────────────────────────────────────────

function handleJoin(socket: WebSocket, roomId: string, name: string) {
  const peerId = randomUUID();
  const peer: Peer = { id: peerId, ws: socket, roomId, name, connectedAt: Date.now() };

  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: new Map(), createdAt: Date.now() };
    rooms.set(roomId, room);
  }

  room.peers.set(peerId, peer);
  peers.set(peerId, peer);

  socket.send(JSON.stringify({
    type: 'joined',
    peerId,
    roomId,
    peers: room.peers.size,
    localIP: getLocalIP(),
  }));

  broadcastToRoom(roomId, {
    type: 'peer-joined',
    peerId,
    peerCount: room.peers.size,
    name,
  }, peerId);

  console.log(`[signaler] "${name}" (${peerId.slice(0, 6)}) joined room ${roomId} — ${room.peers.size} peers`);
}

function handleSignal(socket: WebSocket, msg: any) {
  const peer = Array.from(peers.values()).find(p => p.ws === socket);
  if (!peer) return;

  switch (msg.type) {
    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      const target = peers.get(msg.targetPeerId);
      if (target) {
        target.ws.send(JSON.stringify({ ...msg, fromPeerId: peer.id }));
      }
      break;
    }
    case 'leave':
      handleDisconnect(socket);
      break;
    case 'broadcast':
      broadcastToRoom(peer.roomId, msg, peer.id);
      break;
  }
}

function handleDisconnect(socket: WebSocket) {
  const peer = Array.from(peers.values()).find(p => p.ws === socket);
  if (!peer) return;

  const room = rooms.get(peer.roomId);
  if (room) {
    room.peers.delete(peer.id);
    console.log(`[signaler] "${peer.name}" (${peer.id.slice(0, 6)}) left room ${peer.roomId} — ${room.peers.size} remaining`);
    broadcastToRoom(peer.roomId, {
      type: 'peer-left',
      peerId: peer.id,
      peerCount: room.peers.size,
      name: peer.name,
    });
    if (room.peers.size === 0) rooms.delete(peer.roomId);
  }
  peers.delete(peer.id);
}

function broadcastToRoom(roomId: string, msg: any, excludeId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const [, peer] of room.peers) {
    if (peer.id === excludeId) continue;
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(payload);
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
  console.log(`  │  1. Set VITE_SIGNALING_URL=ws://${ip}:3001      │`);
  console.log(`  │  2. Use the same room ID on both devices         │`);
  console.log(`  └──────────────────────────────────────────────────┘\n`);
});

process.on('SIGINT', () => {
  console.log('\n[signaler] Shutting down...');
  wsServer.close();
  httpServer.close();
  process.exit(0);
});
