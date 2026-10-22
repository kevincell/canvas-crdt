/**
 * Shared signaling-server discovery for room and canvas documents.
 *
 * A LAN guest must never inherit a localhost-only URL that was configured for
 * the host. The browser's visible host is authoritative whenever it is not a
 * loopback address.
 */
let cachedIp: Promise<string> | null = null;

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function fetchLanIp(): Promise<string> {
  if (!cachedIp) {
    cachedIp = fetch('/api/ip', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`LAN discovery failed (${r.status})`)))
      .then(data => String(data.ip || data.localIP || ''))
      .catch(() => '')
      .then(ip => {
        // A later retry can recover if the signaler was still starting up.
        if (!ip) cachedIp = null;
        return ip;
      });
  }
  return cachedIp;
}

function withName(url: URL, actorName: string): string {
  if (actorName) url.searchParams.set('name', actorName);
  return url.toString();
}

export async function resolveSignalingUrl(actorName: string): Promise<string> {
  const configured = (import.meta as any).env?.VITE_SIGNALING_URL as string | undefined;
  const browserHost = window.location.hostname || 'localhost';
  const lanIp = await fetchLanIp();
  const reachableHost = !isLoopback(browserHost) ? browserHost : (lanIp || browserHost);
  const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (configured) {
    try {
      const url = new URL(configured, window.location.href);
      // A URL baked with localhost works on the host, but cannot work on a phone.
      if (isLoopback(url.hostname) && !isLoopback(reachableHost)) url.hostname = reachableHost;
      if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
      if (window.location.protocol === 'https:' && url.protocol === 'ws:') url.protocol = 'wss:';
      return withName(url, actorName);
    } catch {
      // Fall through to the same-origin LAN-safe default.
    }
  }

  const url = new URL(`${socketProtocol}//${reachableHost}:3001/ws`);
  return withName(url, actorName);
}
