// Wrapper to provide ESM default export for simple-peer (CJS package)
import SimplePeer from 'simple-peer';

console.log('[DEBUG] simple-peer-wrapper module loaded');

class PatchedPeer extends (SimplePeer as any) {
  constructor(opts: any) {
    console.log('[DEBUG] PatchedPeer constructor called with opts:', !!opts);
    super(opts);
  }

  _onChannelMessage(event: any) {
    console.log('[DEBUG] PatchedPeer _onChannelMessage called, data len:', event?.data?.byteLength || event?.data?.length);
    if (this.destroyed) return;
    let data = event.data;
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    this.emit('data', data);
  }
}

export default PatchedPeer;

