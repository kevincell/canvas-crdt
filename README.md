# CRDT Canvas

**A free, offline-first, end-to-end encrypted collaborative whiteboard.** No account, unlimited boards, unlimited collaborators. Boards live on your device first and sync peer-to-peer. Concurrent edits **merge instead of overwriting**, and only genuinely ambiguous conflicts are shown to people.

> Built as a free alternative to paid whiteboards (Miro and FigJam cap free plans at 3 editable boards). Install it as an app (PWA) and it works on a plane.

---

## Quick start

```bash
pnpm install
pnpm dev            # signaling server :3001 + app :5173 (Vite proxies /ws)
```

Production (one process serves the app **and** signaling on the same origin):

```bash
pnpm build
PORT=8080 pnpm start          # → http://localhost:8080
```

Docker: `docker build -t crdt-canvas . && docker run -p 8080:8080 crdt-canvas`.

Checks: `pnpm typecheck`, `pnpm test` (engine, client and server unit tests), `pnpm test:e2e` (Playwright, real two-browser P2P).

Optional environment variables: `VITE_SIGNALING_URLS` (client; comma-separated external relays). Server: `PORT`, `HOST`, `STATIC_DIR`, `LAN_DISCOVERY`, `MAX_CONNECTIONS`, `MAX_TOPICS_PER_PEER`, `MAX_PEERS_PER_TOPIC`, `MAX_MESSAGE_BYTES`, `MESSAGES_PER_SECOND`, `MESSAGE_BURST`.

---

## What you get

- **Infinite canvas**: freehand ink (pressure-style strokes), rectangles and ellipses with labels, lines and arrows that **bind to shapes** and follow them, text, sticky notes (auto-fitting text), frames, and images (paste or drop them).
- **Editing**: marquee select, precise hit-testing on real ink rather than bounding boxes, resize from 8 handles (Shift keeps proportions, Alt resizes from the centre), alt-drag to duplicate, snapping to edges, centres and equal gaps, grid, group, lock, layer order, align and distribute, tidy notes, copy/cut/paste across boards, and per-user undo that never reverts other people's work.
- **Navigation**: trackpad pan, pinch and ctrl+wheel zoom, minimap, zoom to fit or selection, follow a collaborator, present frames as slides.
- **Collaboration**: live cursors, selections and typing indicators; comments, chat, timer, dot voting and guided retros; templates; a stencil library; checkpoints; task-tracker export.
- **UI**: light and dark themes (ink adapts per viewer), hand-drawn style, a command palette (`Ctrl+K`) that also searches board content, and full keyboard shortcuts (`?`).
- **Export**: PNG, PDF, copy as image, JSON snapshot, and **merge files** (see below).
- **Local-first**: IndexedDB persistence, a service worker that precaches the whole app, quiet offline states, and pausing sync to draft privately.

---

## Novel ideas

Each idea was checked against existing products and research; where prior art exists, it is credited below.

### 1. Sneakernet Merge: files that merge instead of overwrite
`.crdtcanvas` files carry the board's full CRDT state, not a flattened snapshot. Open a colleague's copy (from email or a USB stick) and the two histories **merge losslessly**: the merge is commutative and idempotent, so opening the same file twice changes nothing. A dry-run preview shows what will be added, changed and removed, and by whom. *Gap addressed:* tldraw's offline app documents that it can't merge files edited elsewhere, and Excalidraw files conflict under file sync. (`packages/engine/src/sneakernet.ts`)

### 2. "While you were away": catch-up replay
When you reopen a board, reconnect, or resume after pausing, the app diffs what this device last saw against the merged result. It summarises other people's changes by intent ("3 added, 2 moved, 1 rewritten by Ana"), and can **animate the replay** or highlight it: green for added, ghosts and paths for moved, red ghosts for removed. Your own edits are filtered out. (`board/session.ts`, `engine/src/diff.ts`)

### 3. Per-property merge registers (schema v2)
Each shape property is an independent CRDT register layered over the legacy snapshot, so *Alice recolours while Bob moves* keeps **both** edits. Excalidraw-style whole-element versioning loses one of them. v1 boards read unchanged and migrate with a recovery backup.

### 4. Causal, consensus-free conflict detection
The original project flagged conflicts using a 30-second wall-clock window, which produced false positives for quick hand-offs. Edits now carry per-shape version vectors, so **only edits that genuinely didn't see each other** are compared. The project's original contributions sit on top: the **union-bounding-box** rule for concurrent resizes, and **intent-ambiguity classification** for divergent moves. Every peer derives the same verdict without network rounds.

### 5. Ephemeral drag previews and conflict forecast
While dragging, only a tiny transform travels over presence; the CRDT is written once on release. Peers see smooth motion and the document history stays compact. When two people grab the same object, both see an amber **"Ana is also moving this"** warning *before* a conflict exists.

### 6. Local-first branches
"Branch this board" forks the full CRDT state into a new board; later you can **merge the branch back** into its parent with a preview, entirely on-device. *Prior art:* Ink & Switch's Patchwork prototyped branches and visual diffs for tldraw; this brings the idea to a serverless P2P whiteboard.

### 7. Honest CRDT Lab
Experiments fork the live document into a "phantom peer", make genuinely concurrent edits, and merge them through the real sync path. This replaced earlier demos that made sequential edits.

### 8. Smaller ideas
- **Hold-to-snap ink**: a deterministic geometric recogniser (line, arrow, ellipse, rectangle; no ML) cleans up shapes when you pause at the end of a stroke.
- **Semantic zoom**: note text magnifies and frames get overview labels when zoomed out.
- **Authorship lens**: shows who touched what.
- **Per-viewer colour adaptation**: ink stays legible in dark mode without changing the stored colours.

---

## R&D process

1. **Audit**: profiled and exercised the original app. Found an infinite render loop, lossy concurrent edits, wall-clock conflict detection, ID-breaking undo, O(n) parsing per edit, bounding-box hit-testing, and misleading "Disconnected" errors for offline users.
2. **Research**: surveyed free-plan limits (Miro and FigJam: 3 boards), tldraw, Excalidraw's merge model, and Ink & Switch's Patchwork, to find unmet needs: lossless offline merging, explainable reconnection, and fine-grained merges.
3. **Hypothesise and build**: each idea above is implemented in the engine or client as a small, testable module.
4. **Evaluate**:
   - 75 engine tests: merge semantics, causality, undo, diff, recognition, hit-testing, merge files.
   - 27 client tests and 9 server tests.
   - 7 Playwright E2E tests covering real P2P sync, offline catch-up, Lab conflicts, and a merge-file round trip.
   - Performance: 3,000 shapes render at about 60 fps (median 16–19 ms per frame, headless), and bulk insert went from 7.9 s to 0.26 s.
   - Offline: verified a full reload with the network cut.

---

Full R&D record (prior art, hypotheses, measurements, limitations): [docs/RESEARCH.md](./docs/RESEARCH.md).

---

## Architecture

```
packages/engine   CRDT model (Yjs): per-property registers, causal conflicts, union-bbox merge,
                  CanvasStore (incremental cache + Y.UndoManager), diff, recognition, hit-testing, merge files
apps/client       React app: Editor (actions), CanvasView (pointer state machine + renderer),
                  BoardSession (IndexedDB + encrypted y-webrtc + catch-up), chrome, PWA service worker
apps/server       Static app + y-webrtc signaling relay (/ws) + /health; CSP, rate limits, no content access
```

**Security:** the board key lives in the URL fragment (`#…?k=`), which browsers never send to servers. y-webrtc encrypts signaling with it, and WebRTC (DTLS) encrypts peer traffic. Room names are never logged in plaintext. View-only links are a UI guard, not a cryptographic boundary; the Share dialog says so.

---

## Team

Akshay V Kamath (NNM23CC004) · Ramnath S Prabhu (NNM23CC045) · Kevin Marshal D Souza (NNM23CC024) · Guide: Mr. Krishna Prasad D S · Department of Computer and Communication Engineering

## License

MIT © 2026 CRDT Canvas Team
