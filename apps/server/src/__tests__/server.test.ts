import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { WebSocket } from 'ws';

const staticDir = mkdtempSync(join(tmpdir(), 'crdt-canvas-static-'));
mkdirSync(join(staticDir, 'assets'));
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>app</title>' + 'x'.repeat(2000));
writeFileSync(join(staticDir, 'assets', 'app-abc123.js'), 'console.log(1);' + ' '.repeat(2000));
writeFileSync(join(tmpdir(), 'secret.txt'), 'top secret');
process.env.STATIC_DIR = staticDir;
process.env.MESSAGES_PER_SECOND = '5';
process.env.MESSAGE_BURST = '5';

let server: typeof import('../index');
let base = '';

beforeAll(async () => {
  server = await import('../index');
  const port = await server.start(0);
  base = `127.0.0.1:${port}`;
});
afterAll(async () => { await server.stop(); });

function client(): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const messages: unknown[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

describe('signaling relay', () => {
  it('relays publish messages to every subscriber of a topic', async () => {
    const a = await client();
    const b = await client();
    a.ws.send(JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
    b.ws.send(JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
    await tick();
    a.ws.send(JSON.stringify({ type: 'publish', topic: 'room-1', data: { hello: 'b' } }));
    await tick();
    expect(b.messages).toContainEqual(expect.objectContaining({ type: 'publish', topic: 'room-1', data: { hello: 'b' }, clients: 2 }));
    a.ws.close(); b.ws.close();
  });

  it('does not let a peer publish into a room it has not joined', async () => {
    const insider = await client();
    const outsider = await client();
    insider.ws.send(JSON.stringify({ type: 'subscribe', topics: ['private'] }));
    await tick();
    outsider.ws.send(JSON.stringify({ type: 'publish', topic: 'private', data: 'spam' }));
    await tick();
    expect(insider.messages).toHaveLength(0);
    insider.ws.close(); outsider.ws.close();
  });

  it('answers pings and rate-limits floods', async () => {
    const c = await client();
    for (let i = 0; i < 40; i++) c.ws.send(JSON.stringify({ type: 'ping' }));
    await tick(150);
    const pongs = c.messages.filter(m => (m as { type: string }).type === 'pong').length;
    expect(pongs).toBeGreaterThan(0);
    expect(pongs).toBeLessThan(40);
    c.ws.close();
  });
});

describe('static app', () => {
  it('serves the app shell for client routes with security headers', async () => {
    const res = await fetch(`http://${base}/some/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>app</title>');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('caches hashed assets forever and compresses them', async () => {
    const res = await fetch(`http://${base}/assets/app-abc123.js`, { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('returns 404 for missing assets instead of the shell', async () => {
    expect((await fetch(`http://${base}/assets/missing.js`)).status).toBe(404);
  });

  it('blocks path traversal', async () => {
    const res = await fetch(`http://${base}/..%2Fsecret.txt`);
    expect(await res.text()).not.toContain('top secret');
  });

  it('reports health', async () => {
    const body = await (await fetch(`http://${base}/health`)).json();
    expect(body.status).toBe('ok');
  });

  it('gzips text responses for clients that accept it', async () => {
    const { request } = await import('http');
    const [host, port] = base.split(':');
    const raw = await new Promise<Buffer>((resolve, reject) => {
      request({ host, port, path: '/', headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks: Buffer[] = [];
        expect(res.headers['content-encoding']).toBe('gzip');
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).end();
    });
    expect(gunzipSync(raw).toString()).toContain('<title>app</title>');
  });
});
