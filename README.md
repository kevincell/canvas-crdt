# CRDT Canvas

A real-time collaborative drawing board using Conflict-free Replicated Data Types and WebRTC.

> **Academic Novelty**: Applied semantic conflict resolution for a 2D collaborative canvas — including a novel union-bounding-box merge rule for concurrent resizes and intent ambiguity detection that surfaces semantically dubious merges without requiring consensus.

## Team

- Akshay V Kamath (NNM23CC004)
- Ramnath S Prabhu (NNM23CC045)
- Kevin Marshal D Souza (NNM23CC024)
- Guide: Mr. Krishna Prasad D S
- Department: Computer and Communication Engineering

## Architecture

```
┌─────────────┐     WebRTC Data Channel     ┌─────────────┐
│   Peer A    │ ◄──────────────────────────► │   Peer B    │
│  (Browser)  │                              │  (Browser)  │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │ IndexedDB (offline persistence)            │ IndexedDB
       │                                            │
       ▼                                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Yjs CRDT Document                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Shapes   │  │ Awareness│  │  History │  │ Conflicts│   │
│  │ (Y.Array)│  │(Y.Map)   │  │ (local)  │  │ (computed)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
       ▲                                            ▲
       │ WebSocket (signaling ONLY)                 │ WebSocket
       └────────────────────────────────────────────┘
                            │
                   ┌────────┴────────┐
                   │  Signaling      │
                   │  Server (:3001) │
                   │  (peer discovery│
                   │   only)         │
                   └─────────────────┘
```

**Key design principle**: The server exists solely for WebRTC peer discovery and NAT traversal setup. All canvas data flows directly between browsers via WebRTC data channels. No centralized authoritative server for canvas data.

## Core Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | TypeScript + Vite + React 18 + HTML5 Canvas API | Rendering and user interaction |
| CRDT | Yjs (with custom semantic hooks) | Conflict-free concurrent editing |
| P2P Transport | WebRTC data channels (via y-webrtc) | Direct browser-to-browser data sync |
| Signaling | Node.js + WebSocket (ws) | Peer discovery and NAT traversal setup ONLY |
| Offline Persistence | IndexedDB (via y-indexeddb) | Local state persistence across sessions |
| Awareness | y-protocols Awareness | Live cursors and user presence |
| Testing | Vitest | Unit tests for engine logic |

## Novel Contributions

### 1. Union-Bounding-Box Merge Rule for Concurrent Resizes

**Problem**: Standard LWW (last-write-wins) CRDT semantics discard one user's resize when two users resize the same shape concurrently. The winner is arbitrary and loses information.

**Solution**: When concurrent resize operations are detected on the same shape, we compute the **union of all bounding boxes** rather than picking one winner. This preserves all contributors' intent in a commutative, associative merge.

```typescript
// In packages/engine/src/core.ts
export function mergeShapes(base: Shape, edits: Shape[]): Shape {
  if (d.kind === ShapeKind.Rect) {
    const bbox = edits.reduce(
      (acc, e) => unionBBox(acc, shapeBBox(e)),
      shapeBBox(base)
    );
    // Result encompasses ALL concurrent resizes
    return { ...base, data: { ...d, x: bbox.minX, y: bbox.minY, w: ..., h: ... } };
  }
}
```

**Why it's novel**: This is a domain-specific merge function with proven UX properties for spatial objects. It's commutative (order doesn't matter) and idempotent (applying the same edit twice has no additional effect) — both required for CRDT correctness.

### 2. Intent Ambiguity Detection (Novel Contribution)

**Problem**: CRDT research traditionally treats silent convergence as the goal. But when two users' intents significantly diverge (e.g., moving the same object to opposite sides of the canvas), silent auto-merging is a trust problem — the system converges but the result may not make sense to either user.

**Solution**: We build a system that **detects and surfaces semantically dubious merges**. The detection is a pure function computed independently by all peers — no consensus protocol needed. All peers raise the same flag because they observe the same state.

```typescript
// Ambiguity is computed purely from geometry, no network needed
export function classifyAmbiguity(a: Shape, b: Shape): AmbiguityLevel {
  const displacement = distance(shapeCenter(a), shapeCenter(b));
  const ratio = displacement / max(size(a), size(b));
  if (ratio < 0.1) return 'none';
  if (ratio < 0.5) return 'low';
  if (ratio < 1.5) return 'medium';
  return 'high';
}
```

**Why it's novel**: Most CRDT systems converge and call it a day. This one asks *"did that convergence make sense?"* and tells the user. The detection is deterministic and identical across all peers without requiring agreement.

### 3. Merge-History Playback

A transparent replay of all merge events — creates, updates, conflicts, and resolutions — allowing users to step through the evolution of the canvas and understand how concurrent edits were resolved.

### 4. Offline-First P2P Synchronization

IndexedDB persistence via `y-indexeddb` ensures that each peer maintains a complete local copy of the canvas. When connections are re-established, Yjs CRDT reconciliation ensures convergence without conflicts.

## Project Structure

```text
crdt-canvas/
├── packages/
│   └── engine/              # Core CRDT engine (shape types, conflict detection, merge rules)
│       └── src/
│           ├── core.ts      # Shape types, geometry, ambiguity, merge logic
│           ├── yjs-canvas.ts # Yjs integration layer
│           └── index.ts     # Public exports
├── apps/
│   ├── server/              # WebRTC signaling server (discovery ONLY)
│   │   └── src/index.ts
│   └── client/              # React + Vite + Canvas frontend
│       ├── src/
│       │   ├── App.tsx                 # Main app component
│       │   ├── features/               # Feature-sliced component domains
│       │   │   ├── canvas/             # Rendering and toolbar
│       │   │   ├── crdt/               # Conflict panels and offline simulation
│       │   │   ├── chat/               # Collaborative chat
│       │   │   └── demo/               # Side-by-side demo containers
│       │   ├── views/                  # Page-level components (JoinScreen, etc.)
│       │   ├── components/             # Reusable UI components
│       │   └── hooks/
│       │       └── useCanvasCRDT.ts    # Yjs + WebRTC + IndexedDB orchestration
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 8

### Install

```bash
cd crdt-canvas
pnpm install
```

### Run

```bash
# Terminal 1: Start signaling server
pnpm run dev:server

# Terminal 2: Start client
pnpm run dev:client
```

Open two browser tabs to the same room ID to test collaboration.

### Testing

```bash
# Run engine tests
pnpm run test --filter @crdt-canvas/engine

# Type checking
pnpm run typecheck
```

## Academic Framing

### What is Novel

| # | Contribution | Status |
|---|-------------|--------|
| 1 | Union-bounding-box semantic merge for concurrent resizes | **Novel** — domain-specific CRDT merge rule |
| 2 | Intent ambiguity detection (pure function, no consensus) | **Novel** — surfaces semantically dubious merges |
| 3 | Merge-history playback for transparency | Engineering — known pattern, new application |
| 4 | Offline-first P2P with IndexedDB + WebRTC | Engineering — proven stack (y-webrtc + y-indexeddb) |

### What is Established (Not Novel)

- Yjs as the CRDT engine (multi-agent system, OT-agnostic)
- WebRTC data channels for P2P transport
- WebSocket signaling for peer discovery / NAT traversal
- IndexedDB for client-side persistence
- Awareness protocol for cursor/presence tracking

### Research Questions

1. Does the union-bbox merge rule produce results that users find more satisfactory than LWW for collaborative resizing?
2. Does ambiguity detection improve trust in CRDT-converged systems?
3. How does offline-first P2P synchronization perform under network partitions?

## License

MIT
