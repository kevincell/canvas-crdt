// Type declarations for simple-peer (CJS package without types)
declare module 'simple-peer' {
  import { EventEmitter } from 'events';
  interface SimplePeerOptions {
    initiator?: boolean;
    trickle?: boolean;
    allowHalfOpen?: boolean;
    insertAdditionalCandidates?: boolean;
    objectMode?: boolean;
  }
  class SimplePeer extends EventEmitter {
    constructor(options?: SimplePeerOptions);
    signal(data: any): void;
    destroy(): void;
    readonly buffer: any;
    readonly id: string;
    readonly type: string;
  }
  export default SimplePeer;
}
