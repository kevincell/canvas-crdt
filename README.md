# CRDT Canvas

A local-first, real-time collaborative drawing board powered by Conflict-free Replicated Data Types (CRDTs), peer-to-peer WebRTC synchronization, and semantic conflict detection.

> **Academic Novelty**: Applied semantic conflict resolution for a 2D collaborative canvas — including a novel union-bounding-box merge rule for concurrent resizes and intent ambiguity detection that surfaces semantically dubious merges without requiring consensus or an authoritative server.

---

## Team

- **Akshay V Kamath** (NNM23CC004)
- **Ramnath S Prabhu** (NNM23CC045)
- **Kevin Marshal D Souza** (NNM23CC024)
- **Guide**: Mr. Krishna Prasad D S
- **Department**: Computer and Communication Engineering

---

## Architecture

```
┌─────────────┐     WebRTC Data Channel (Direct P2P)    ┌─────────────┐
│   Peer A    │ ◄─────────────────────────────────────► │   Peer B    │
│  (Browser)  │                                         │  (Browser)  │
└──────┬──────┘                                         └──────┬──────┘
       │                                                       │
       │ IndexedDB (offline-first local persistence)           │ IndexedDB
       │                                                       │
       ▼                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Yjs CRDT Document                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │
│  │    Shapes    │  │  Awareness   │  │   Comments   │  │  Meta   │  │
│  │ (Y.Array/XML)│  │ (ephemeral)  │  │   (Y.Array)  │  │ (Y.Map) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────────────────┘
       ▲                                                       ▲
       │ WebSocket (ephemeral signaling ONLY)                  │ WebSocket
       └───────────────────────────────────────────────────────┘
                                   │
                          ┌────────┴────────┐
                          │ Signaling Server│
                          │     (:3001)     │
                          │ (ICE/SDP relay) │
                          └─────────────────┘
```

**Key Architectural Principles**:
- **Zero Authoritative Server**: The signaling server exists solely for WebRTC peer discovery, SDP exchange, and NAT traversal. All canvas mutations, awareness states, and comments flow directly between browsers over encrypted WebRTC data channels.
- **Local-First Persistence**: Canvas state persists in IndexedDB (`y-indexeddb`), allowing full offline authoring. Edits made while offline reconcile automatically upon reconnection.
- **Client-Side Read-Only Guard**: Shared viewer links enforce mutation suppression at the application and CRDT layer, keeping read-only consumers from polluting the shared document.

---

## Technology Stack

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | React 18, TypeScript, HTML5 Canvas API | High-performance 60 FPS 2D rendering, custom gesture physics, accessibility |
| **Styling** | Emotion / Material UI (MUI), CSS | Sleek glassmorphism dark theme, floating toolbars, responsive overlay layouts |
| **CRDT Engine** | Yjs, y-protocols Awareness | Conflict-free state synchronization, distributed undo/redo, presence cursors |
| **P2P Transport** | WebRTC Data Channels (y-webrtc / simple-peer) | Direct browser-to-browser encrypted replication |
| **Signaling** | Node.js, `ws` (WebSocket) | Ephemeral session discovery and ICE candidate exchange |
| **Persistence** | IndexedDB (`y-indexeddb`) | Zero-latency local hydration and offline buffer |
| **Testing** | Vitest, Playwright | Unit tests (engine & client) and end-to-end integration tests |

---

## Core Capabilities

### 1. Spatial Authoring & Canvas Manipulation
- **Shape Primitives**: Rectangles, ellipses, straight lines, sticky notes, multiline text, freehand strokes, and raster images.
- **Connectors & Magnetic Snap**: Line endpoints attach magnetically to object boundaries, compute angle-aware perimeter anchors, and follow target moves/resizes.
- **Styling Controls**: Shared active palette, hex colour picker, fill opacity, stroke width, and corner radius.
- **Alignment & Snapping**: Real-time edge/center alignment guides, equal distance gap detection with live distance labels, and one-batch multi-object alignment/distribution.
- **Deterministic Note Tidy**: Clean column-based auto-layout for brainstorming notes captured in a single undoable transaction.

### 2. Framing & Presentation Mode
- **Frames**: Named frame containers that group and move contained children.
- **Nested Frames**: Frames support hierarchical containment and transform propagation.
- **Text Scale Invariant (L32)**: Frame resizes scale geometric bounds and positions, but preserve text glyph readability and typography without micro-scaling.
- **Presentation Slideshow**: Cycle through named frames in presentation mode with smooth viewport transitions and keyboard navigation (<kbd>Space</kbd>, <kbd>Arrow</kbd>).

### 3. Facilitation & Collaboration Suite
- **Guided Retrospectives**: 4 structured stages (*Gather* 💬, *Group* 🗂️, *Vote* 🗳️, *Commit* ✅) with facilitator guidance boxes and participant prompts.
- **Dot Voting**: Configurable votes-per-person limits, live dot badges on canvas objects, and ranked medal leaderboard.
- **Shared Timer**: Synchronized countdown timer with visual status chips and audio chimes.
- **Anchored Comments**: Threaded discussion pins anchored to canvas coordinates with status toggles (*Open* / *Resolved*) and emoji reactions.
- **Presence & Lasers**: Ephemeral laser pointers with decaying trails, live cursor tags, and co-collaborator avatars.

### 4. Recovery, Migration & Stencils
- **Schema Migration**: Versioned schema upgrading (v0 → v1) with preflight validation, idempotency, dry-run evaluation, and rollback backups.
- **Named Checkpoints**: Snapshot and restore board versions as editable copies.
- **Reusable Stencils**: Save native selections to a local stencil library (up to 50 items, 10 versions each, preview render) with automatic group and connector remapping on insertion.
- **Curated Starter Templates**: 1-click instantiation for Brainstorming, Sprint Retrospective, Kanban Delivery, and Systems Architecture.
- **Task Tracker Handoff**: Format sticky notes and frame-grouped tasks to GitHub Issues Markdown, Jira CSV, or Webhook JSON with user data boundary consent.

### 5. Accessibility & Search
- **Quick Find (<kbd>Ctrl</kbd>+<kbd>F</kbd>)**: Real-time full-text search across notes, text, and frame titles with pulsing beacon zoom navigation.
- **Keyboard-Only Workflow**: Full canvas navigation using <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> to cycle shapes, <kbd>Arrow</kbd> keys to nudge (1 px / 10 px), and <kbd>Enter</kbd> / <kbd>F2</kbd> for inline text editing.
- **Assistive Technology**: Screen-reader live regions (`aria-live="polite"`) announcing selection changes, nudges, search matches, and facilitation state.

---

## Novel Academic Contributions

### 1. Union-Bounding-Box Merge Rule for Concurrent Resizes
Standard Last-Write-Wins (LWW) CRDT semantics arbitrarily discard one participant's work when two peers resize the same shape concurrently.

**Our Solution**: When concurrent resize operations are detected on the same shape, the engine computes the **union bounding box** of both edits:
$$\text{Box}_{\text{merged}} = \text{Box}_A \cup \text{Box}_B = [\min(x_{A1}, x_{B1}), \min(y_{A1}, y_{B1}), \max(x_{A2}, x_{B2}), \max(y_{A2}, y_{B2})]$$

This merge is **commutative**, **associative**, and **idempotent**, ensuring mathematical CRDT convergence while respecting both collaborators' spatial intent without data loss.

### 2. Intent Ambiguity Detection (Consensus-Free)
Standard CRDT systems converge silently, even when two concurrent operations represent conflicting user intent (e.g. Peer A moves a shape to the top-left while Peer B moves it to the bottom-right).

**Our Solution**: A deterministic classification function computed independently by all peers:
$$\text{Displacement} = \|\text{Center}_A - \text{Center}_B\|$$
$$\text{Ambiguity Ratio} = \frac{\text{Displacement}}{\max(\text{Size}_A, \text{Size}_B)}$$

- $\text{Ratio} < 0.1 \implies \text{None}$
- $0.1 \le \text{Ratio} < 0.5 \implies \text{Low}$
- $0.5 \le \text{Ratio} < 1.5 \implies \text{Medium}$
- $\text{Ratio} \ge 1.5 \implies \text{High}$

Because the function is pure and evaluated over identical CRDT states, all peers raise identical ambiguity flags **without needing consensus protocols or network rounds**.

### 3. Merge History Playback
Complete timeline tracking that records creates, updates, deletes, conflicts, and auto-merges, enabling visual scrub-through playback of board evolution.

---

## Monorepo Layout

```text
crdt-canvas/
├── apps/
│   ├── client/                      # React 18 + Vite client application
│   │   └── src/
│   │       ├── features/
│   │       │   ├── canvas/          # CanvasRenderer, Toolbar, CanvasController, exports
│   │       │   │   └── __tests__/   # boardDuplication, imageLimits, readOnlyGuard tests
│   │       │   ├── crdt/            # StatusPanel, Conflict widgets, TimeTravel, MergeLens
│   │       │   ├── facilitation/    # FacilitationPanel (timer, dot voting, guided retros)
│   │       │   ├── comments/        # useBoardComments, CommentsPanel
│   │       │   ├── checkpoints/     # useBoardCheckpoints, CheckpointsPanel
│   │       │   ├── stencils/        # stencilStore, useStencils, StencilsPanel
│   │       │   ├── templates/       # curatedTemplates, TemplatesModal
│   │       │   ├── integrations/    # taskHandoff, TaskTrackerHandoffModal
│   │       │   │   └── __tests__/   # taskHandoff tests
│   │       │   ├── sharing/         # ShareBoardModal (editor, viewer, presenter links)
│   │       │   ├── chat/            # Collaborative P2P text chat
│   │       │   └── demo/            # Showcase bar, DualPeerContainer
│   │       ├── hooks/               # useCanvasCRDT (orchestrates Yjs, WebRTC, IndexedDB)
│   │       └── views/               # SingleCanvasView, JoinScreen
│   └── server/                      # Lightweight WebRTC signaling relay (discovery only)
│       └── src/index.ts
├── packages/
│   └── engine/                      # Standalone CRDT engine library
│       └── src/
│           ├── core.ts              # Shape types, vector clocks, ambiguity, union-bbox
│           ├── yjs-canvas.ts        # Yjs document binding, schema migration, transactions
│           └── __tests__/           # 5 test suites (core, history, peer round-trip,
│                                    # frame transforms, performance budgets)
├── docs/                            # Specifications, security model, and roadmaps
│   ├── PRODUCT_ROADMAP.md           # 15-sprint feature specifications
│   ├── ROADMAP_PROGRESS.md          # Implementation verification tracker
│   ├── TECHNICAL_DESIGN.md          # Architectural blueprints and CRDT math
│   ├── INTEGRATION_DISCOVERY.md     # Extension points and export boundary contracts
│   └── SHARING_AND_ACCESS_CONTROLS.md # Threat model and permission matrix
├── tests/
│   └── e2e/                         # Playwright end-to-end integration tests
├── package.json                     # Monorepo scripts and root dependencies
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 8.0.0`

### Installation

```bash
# Clone the repository
git clone https://github.com/kevincell/canvas-crdt.git
cd crdt-canvas

# Install dependencies across all workspaces
pnpm install

# Build the engine library
pnpm --filter @crdt-canvas/engine build
```

### Running Locally

```bash
# Start both the signaling server (:3001) and Vite dev server (:5173) concurrently
pnpm run dev
```

- **Client**: [http://localhost:5173](http://localhost:5173)
- **Signaling Server**: `ws://localhost:3001`

To test multi-user collaboration:
1. Open [http://localhost:5173](http://localhost:5173) in Tab A, enter your name, and join a room.
2. Open the same URL with the same Room ID in Tab B (or an incognito window).
3. Draw, move objects, or test concurrent resize to observe real-time CRDT synchronization!
4. Or click **"Dual Tab"** in the top navigation bar to open a split-screen side-by-side simulation within a single tab.

---

## Verification & Testing

The project includes unit, integration, round-trip, and performance suites:

```bash
# Run all unit & integration tests across engine and client (62 tests)
pnpm test

# Run tests with watch mode
pnpm --filter @crdt-canvas/engine test:watch

# Run TypeScript typechecks across engine, client, and server
pnpm typecheck

# Run Playwright end-to-end tests
pnpm exec playwright test
```

### Test Coverage Highlights
- **Engine Tests** (45 tests):
  - `core.test.ts`: Vector clocks, bounding box calculations, LWW resolution, deduplication.
  - `history.test.ts`: Merge history timelines, undo/redo replay, conflict indexing.
  - `peer_roundtrip.test.ts`: Yjs encoding/decoding round-trips, reconnect recovery, v0 legacy migration idempotency, concurrent move detection.
  - `frameTransforms.test.ts`: Nested frame transforms, recursive descendant tracking, text-scale invariant verification.
  - `performanceBudget.test.ts`: 1,000 shapes bounding box (<16 ms), spatial viewport culling (<10 ms), stroke simplification (<5 ms).
- **Client Tests** (17 tests):
  - `taskHandoff.test.ts`: Export to GitHub Markdown, Jira CSV, Webhook payload, boundary consent.
  - `boardDuplication.test.ts`: Safe deep cloning, ID remapping, curated template instantiation.
  - `imageLimits.test.ts`: 15 MB file limit, 2 MB base64 limit, 25 MB cumulative board quota checks.
  - `readOnlyGuard.test.ts`: Mutation suppression and document tamper prevention in read-only mode.

---

## Security & Access Control

Access control in `@crdt-canvas` is documented in [docs/SHARING_AND_ACCESS_CONTROLS.md](./docs/SHARING_AND_ACCESS_CONTROLS.md) and follows a defense-in-depth model:
- **Editor (`role=editor`)**: Full read/write access.
- **Viewer (`role=viewer`)**: Read-only access; drawing, moving, resizing, text editing, and undo/redo APIs are replaced with inert no-ops via `useCanvasCRDT`.
- **Presenter (`role=viewer&present=true`)**: View-only mode with presentation slideshow interface.
- **DTLS-SRTP**: WebRTC media and data channels are end-to-end encrypted between peer endpoints.

---

## Documentation

- [Roadmap & Specifications](./docs/PRODUCT_ROADMAP.md)
- [Delivery Tracker](./docs/ROADMAP_PROGRESS.md)
- [Technical Design & CRDT Math](./docs/TECHNICAL_DESIGN.md)
- [Sharing, Threat Model & Permissions](./docs/SHARING_AND_ACCESS_CONTROLS.md)
- [Integration Discovery & Extension Points](./docs/INTEGRATION_DISCOVERY.md)

---

## License

MIT © 2026 CRDT Canvas Team
