# Technical Design — CRDT Canvas

## 1. CRDT Architecture

### 1.1 Why Yjs?

Yjs implements a **multi-agent system** (MAS) CRDT that is:
- **OT-agnostic**: Works with any transport (WebRTC, WebSocket, etc.)
- **State-based**: Merges full states, not just operations
- **Commutative, Associative, Idempotent (CAA)**: The three mathematical properties required for CRDT correctness

The shapes are stored as a `Y.Array<Y.XmlElement>` where each element represents one shape with attributes for id, kind, actor, vector clock, and serialized data.

### 1.2 Vector Clocks

Each shape carries a `ShapeVector` (map of actor → operation count) that serves as a causal history. This is different from Yjs's internal vector clock — it's an application-level vector used for:
- Ordering concurrent edits
- Computing ambiguity (how "far apart" are two intents?)
- Detecting causal dependencies

### 1.3 LWW vs. Semantic Merge

Yjs's default merge for concurrent writes is **LWW (last-writer-wins)** based on vector clock comparison. For our application:

| Operation | Default LWW | Semantic Merge |
|-----------|-------------|----------------|
| Create | First writer wins | Always accepted |
| Delete | Delete wins (tombstone) | Delete wins |
| Move | Last writer wins | **Union of positions** (novel) |
| Resize | Last writer wins | **Union bounding box** (novel) |
| Color change | Last writer wins | Last writer wins (no spatial conflict) |
| Text edit | Last writer wins | Last writer wins (inherently sequential) |

## 2. Conflict Detection Pipeline

```
Yjs update received
      │
      ▼
Rebuild shape list from Y.Array
      │
      ▼
Index shapes by ID
      │
      ▼
Detect concurrent edits on same ID
      │
      ▼
Compute ambiguity level (pure function)
      │
      ▼
Emit Conflict[] to UI
      │
      ▼
UI renders conflict overlays + panel
```

All peers compute the same conflicts because:
1. They all receive the same Yjs updates (CRDT guarantee)
2. The ambiguity function is deterministic
3. No consensus protocol is needed — convergence is guaranteed by Yjs

## 3. WebRTC Integration

### 3.1 Architecture

```
Browser A ──WebRTC─────── Browser B
     │                      │
     │  y-webrtc provider   │  y-webrtc provider
     │  (data channels)     │  (data channels)
     │                      │
     ▼                      ▼
  Yjs Doc               Yjs Doc
  (CRDT synced)         (CRDT synced)
```

### 3.2 Signaling vs. Data

| What | Transport | Server involvement |
|------|-----------|-------------------|
| Peer discovery | WebSocket | **Yes** — assigns room IDs |
| SDP exchange | WebSocket | **Yes** — relays offers/answers |
| ICE candidates | WebSocket | **Yes** — relays candidates |
| Canvas data | WebRTC data channel | **No** — direct P2P |

### 3.3 NAT Traversal

y-webrtc handles ICE candidate exchange via the signaling server. Once connected, all data flows through the WebRTC data channel without server involvement.

## 4. IndexedDB Persistence

```typescript
// One IndexedDB database per (user, room) combination
const provider = new IndexeddbProvider(doc, `crdt-canvas-${actorName}`);

// On reconnect:
// 1. Load latest snapshot from IndexedDB
// 2. Apply to Yjs doc
// 3. Sync with peers via WebRTC
// 4. CRDT merge resolves any divergences
```

## 5. Awareness Protocol

```typescript
const awareness = new Awareness(doc);
awareness.setLocalStateField('cursor', { x: 100, y: 200 });
awareness.setLocalStateField('actor', 'Alice');
awareness.setLocalStateField('color', '#7c3aed');

// Remote cursors are rendered as colored arrows with names
```

## 6. Merge History

Each Yjs update is logged as a `MergeEvent`. The history is replayable:

```
Step 0: [empty]
Step 1: [stroke by Alice]
Step 2: [stroke by Alice, rect by Bob]
Step 3: [stroke by Alice, rect by Bob, rect by Alice (concurrent resize)]
        ⚠ Conflict: high ambiguity — union bbox applied
Step 4: [stroke by Alice, rect by Bob (union bbox), text by Alice]
```

## 7. Partition Simulator

For testing and demonstration:

| Scenario | What it tests |
|----------|--------------|
| Network split | Two peers can't see each other — do edits diverge? |
| Reconnect | Do they converge when reconnected? |
| Offline edit | Can a peer edit without connectivity? |
| Slow sync | Does the UI handle lag gracefully? |
