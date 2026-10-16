# R&D record — CRDT Canvas 1.0

This document records how the 1.0 redesign was researched, what was hypothesised, how each idea was built and evaluated, and what remains open. Claims here are backed by tests in the repository; file paths are given so each result can be re-run.

---

## 1. Questions

1. Can a free, no-account, offline-first whiteboard match the everyday experience of paid tools while keeping **zero server-side content**?
2. Where do existing whiteboards lose work or confuse people when collaboration is **intermittent** (offline, laptops closing, files emailed around)?
3. Which parts of the original academic contribution (union-bounding-box merge, intent-ambiguity flags) hold up under real concurrency, and what do they need to become product features?

## 2. Baseline audit (v0.1)

Measured on the original code before any change:

| Finding | Effect |
|---|---|
| `Maximum update depth exceeded` loop in the board view | UI instability on every board |
| Shape stored as one JSON blob per element | Concurrent edits to *different* properties: one person's edit lost |
| Conflicts = "two actors edited within 30 s" | Quick sequential hand-offs flagged as conflicts; real concurrency after 30 s missed |
| Hand-rolled undo re-created deleted shapes with new ids | Undo broke connectors attached to the shape |
| Every update re-parsed every shape | Cost grows with board size on each keystroke/drag frame |
| Bounding-box hit testing | Clicking empty corners of a diagonal stroke selected it |
| Stroke width divided by zoom | Ink did not scale with zoom |
| App mode held in React state | Refresh dropped the user out of their board; boards had no shareable URL |
| "Disconnected" shown in red with no peers | Normal offline use presented as an error |
| Demos made two *sequential* local edits | Demonstrated merge behaviour that real peers would not produce |

## 3. Prior art surveyed

- **Miro / FigJam free plans**: 3 editable boards (2026). Gap: free and unlimited.
- **Excalidraw**: per-element version numbers; the latest version of an element wins. Gap: concurrent edits to different properties of one element are not both kept.
- **tldraw**: real-time sync via a server; *tldraw offline* documents that it cannot merge a file changed on another computer. Gap: lossless file-based merging.
- **Ink & Switch, Patchwork** (2024): branches, timelines and visual diffs, including a tldraw-based prototype (green glow for added, ghosts for deleted). Credited as prior art for branching and diff visualisation.
- **Yjs** (CRDT library), **y-webrtc** (P2P transport with optional password encryption), **perfect-freehand**, **rough.js**: building blocks.

## 4. Hypotheses → implementations → evidence

| # | Hypothesis | Implementation | Evidence |
|---|---|---|---|
| H1 | Per-property registers keep both edits when peers change different properties, without breaking v1 boards | `p:<field>` attributes overlaid on the v1 snapshot; schema v2 migration with backup | `v2_engine.test.ts` → *per-property merge* (3 tests); legacy fixture tests in `peer_roundtrip.test.ts` |
| H2 | Causal (version-vector) concurrency removes false positives without losing real conflicts | `seq` + `seen` on each actor edit; `editsAreConcurrent` | *does not flag sequential edits*, *flags truly concurrent divergent moves*, identical verdicts on both peers |
| H3 | The union-bounding-box rule still holds with per-property storage | Rule applied only to causally concurrent resizes | *merges concurrent resizes on both sides into their union* |
| H4 | `Y.UndoManager` with origin tracking gives per-user, id-preserving undo and one step per drag | `CanvasStore` | *undo restores … same id*, *never reverts a collaborator's edits*, *groups a continuous drag* |
| H5 | Shipping full CRDT state in a file allows lossless, order-independent, repeatable merges | `.crdtcanvas` format + dry-run preview | *merges two offline copies losslessly, commutatively and idempotently*; E2E *merge files combine two offline copies* |
| H6 | A semantic diff since "last seen" makes reconnection understandable | Baseline at load / disconnect / pause; settle; intent-classified diff; replay animation | `diffBoards` tests; E2E *returning peer gets a catch-up* |
| H7 | Ephemeral awareness previews give smooth remote motion and a compact history | Translate/scale previews in presence; single commit on release; contested-object warning | Manual two-browser verification; 1 CRDT write per drag (undo test) |
| H8 | Simple geometry is enough for reliable ink-to-shape snapping | Resampling + fit errors + corner occupancy + arrow hook test | 5 recognition tests (line, arrow, rect, ellipse, scribble rejected) |
| H9 | Real-geometry hit testing is cheap enough with a spatial index | Grid index + distance-to-ink / interior rules | 3 hit-test tests; frame-rate measurements below |
| H10 | The whole app can run with the network cut | Build-time precache list in the service worker; same-origin signaling | Manual: reloaded the production build offline, created content, status "Offline · Saved on this device" |

## 5. Measurements

Environment: headless Chromium, no GPU, Linux, dev machine.

| Scenario | Result |
|---|---|
| Insert 3,000 mixed shapes (one transaction) | 7,881 ms → **257 ms** after removing an O(n²) layer scan |
| Pan with all 3,000 shapes visible | median 19 ms / p95 24 ms per frame |
| Pan at 100% | median 16.6 ms / p95 19 ms |
| Drag at 100% | median 16.7 ms / p95 18.6 ms |
| Initial download (gzip) | ≈ 211 KB (MUI moved out of the critical path) |

Test totals: engine 75, client 27, server 9 unit tests; 7 Playwright end-to-end tests with real two-browser WebRTC.

## 6. Limitations and open questions

- **View-only links are not a security boundary.** Anyone with the key can write; true read-only needs signed updates (e.g. per-writer keys). Stated in the Share dialog.
- **Text editing is register-based.** Two people typing in the *same* note at the same moment resolve last-writer-wins per throttled update; collaborative text (Y.Text) per note is a natural next step.
- **Tombstones grow.** Deleted shapes are soft-deleted to keep undo, merges and catch-up exact; long-lived boards would benefit from a compaction policy agreed by peers.
- **NAT traversal** uses public STUN only; restrictive networks need a TURN server (configurable via `peerOpts`, not shipped).
- **Session timeline** is per tab; persistent, shareable history (Patchwork-style) is future work.
- The frame-rate numbers are from headless software rendering; real devices with GPUs are typically faster, low-end phones slower.

## 7. Reproducing

```bash
pnpm install
pnpm test          # unit tests (engine, client, server)
pnpm test:e2e      # starts both servers, runs real P2P scenarios
```
