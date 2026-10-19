/**
 * Shared signaling-server discovery (same logic for the room channel and every board channel).
 * The Node server only introduces peers; all data flows peer-to-peer.
 */
let cachedIp: Promise<string> | null = null;

export function fetchLanIp(): Promise<string> {
  if (!cachedIp) {
    cachedIp = fetch('/api/ip')
      .then(r => r.json())
      .then(data => String(data.ip || data.localIP || ''))
      .catch(() => '');
  }
  return cachedIp;
}

export async function resolveSignalingUrl(actorName: string): Promise<string> {
  const query = actorName ? `?name=${encodeURIComponent(actorName)}` : '';
  const envUrl = (import.meta as any).env?.VITE_SIGNALING_URL as string | undefined;
  if (envUrl) return envUrl.includes('?') ? `${envUrl}&name=${encodeURIComponent(actorName)}` : `${envUrl}${query}`;
  const ip = await fetchLanIp();
  const host = window.location.hostname || 'localhost';
  const targetHost = host && host !== 'localhost' && host !== '127.0.0.1' ? host : (ip || 'localhost');
  return `ws://${targetHost}:3001/ws${query}`;
}
