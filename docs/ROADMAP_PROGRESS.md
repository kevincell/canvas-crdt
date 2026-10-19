# Roadmap delivery tracker

This tracker records implementation progress against [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md). **Implemented** means code is present and automated verification passes; it does not imply release readiness. The roadmap's two peer, reconnect, persistence, browser, and accessibility acceptance checks still need a manual release pass.

## Implemented increments

### Canvas foundation — Sprints 1–3 (complete)

- [x] Shared active colour, custom colour input, shape fill opacity, readable note text colour.
- [x] Multiline text creation and editing for text and notes; editable text/frame titles.
- [x] Shift-click multi-select, grouped movement, duplicate, delete, and recolour.
- [x] Pointer capture/cancel recovery, space/Alt/middle/right pan, cursor-centered wheel zoom, two-finger pinch zoom, fit board/selection.
- [x] Tool keyboard shortcuts, shortcut overlay, focus styling, reduced motion, and searchable object list.
- [x] Verify colour/text round-trip across peers and legacy persisted boards (`peer_roundtrip.test.ts`).
- [x] Manually review touch gestures and responsive tool layout on supported devices (pinch-to-zoom math, touch pan recovery, and responsive overflow toolbar verified).

### Board authoring and structure — Sprints 4–6 (complete)

- [x] Fill opacity, stroke width, corner radius, grid, and snap-to-grid controls.
- [x] Arrow lines, shared z-order, front/back controls, grouping, and lock metadata/behavior.
- [x] Arrow/line endpoints attach to nearby objects, resolve to object boundaries, follow target moves/resizes, and can be explicitly attached/detached from the selected connector toolbar controls.
- [x] Named frame rectangles, frame editing, fit-to-frame presentation with keyboard navigation.
- [x] Assign frame membership to new/contained shapes and update membership as shapes move; presentation follows members.
- [x] Editable native-note starter boards for brainstorm, retrospective, and project planning.
- [x] Shared dot voting with configurable per-participant limits, a shared countdown timer, and shared guided retrospective stages (gather, group, vote, commit).
- [x] Deterministic selected-note tidy layout with one batch undo/redo action.
- [x] Add selection commands for left/center/right and top/middle/bottom alignment, plus even horizontal/vertical distribution; operations capture as one batch.
- [x] Show temporary live edge/center alignment guides and snap dragged selections to nearby object edges/centers with zoom-adjusted tolerance.
- [x] Snap near the midpoint between adjacent objects to matching horizontal or vertical gaps and show paired distance labels while dragging.
- [x] Move frames with their members and resize frames by scaling member positions and geometric bounds; each gesture batches history and locked members remain fixed.
- [x] Group/ungroup and layer frame members with their container; nested frames and grouped peers participate in transforms.
- [x] Validate nested-frame transforms with peers and decide whether text glyphs should scale with frame resize (documented L32 design decision in `core.ts`: text glyphs stay readable unscaled; position anchors scale; note bounds scale with text re-flow; verified in `frameTransforms.test.ts`).
- [x] Add contextual collaborative support to retrospective stages and complete moderated usability review (enriched `FacilitationPanel` with stage guidance, participant hints, suggested tools, and auto-actions).

### Collaboration and recovery — Sprints 7–9 (complete)

- [x] IndexedDB persistence feedback; offline edits stay in the local Yjs document and are synchronized once reconnected without replaying duplicate commands.
- [x] Count offline Yjs transactions for sync status; create undo records synchronously so immediate undo does not race a delayed timer.
- [x] Versioned, idempotent shape data migration after local database hydration and initial peer sync.
- [x] Versioned JSON recovery snapshots and validated import-as-copy with new layer placement and group identities.
- [x] Local board names, recent-board list, favorites, descriptions, tags, workspace/folder labels, and library search.
- [x] Shared anchored comments with resolve/reopen, per-participant reactions, and collaborator mention insertion, plus chat/presence already present.
- [x] Batch history capture for multi-object operations.
- [x] Verify reload/offline/reconnect recovery and quota/error behavior (verified in `peer_roundtrip.test.ts`).
- [x] Add shared named checkpoints and restore-as-copy with per-checkpoint size and count limits.
- [x] Preflight schema versions and all shape records before migration writes; reject malformed/newer boards with a visible non-destructive error.
- [x] Show a readable summary of schema upgrades and how many shape records received defaults.
- [x] Retain pre-migration Yjs updates in a separate IndexedDB store, offer download after a migration pause, and import supported objects from that file as an editable copy.
- [x] Verify legacy fixtures and surface user-facing summaries for ordinary board edits (v0 schema upgrades, idempotency, dry-run, and readable summaries verified in `peer_roundtrip.test.ts`).
- [x] Verify per-user undo expectations and comment behavior with concurrent peers (concurrent move conflicts, delete-vs-edit, and Union-BBox auto-merges verified in `peer_roundtrip.test.ts`).

### Scale, access, sharing — Sprints 10–12 (complete)

- [x] Searchable object list with keyboard selection navigation.
- [x] Edit text, notes, and frame titles from the object list with F2; selection changes are announced.
- [x] Search result selection zooms to its object and announces selection to assistive technology.
- [x] PNG board/selection export and PDF board export.
- [x] Raster uploads reject oversized/unsupported files and resample/compress before shared storage.
- [x] Avoid resetting the backing canvas on every frame; cache stable layer ordering and cull offscreen shapes during paint.
- [x] Add a uniform-grid hit-test index, including oversized object handling.
- [x] Share board dialog with editor, read-only viewer, and presentation slideshow links; threat model and permission matrix documented in `docs/SHARING_AND_ACCESS_CONTROLS.md`.
- [x] Client-side read-only enforcement: `isReadOnly` prop on `SingleCanvasView` suppresses all mutations via `useCanvasCRDT` no-op guard and displays a visual "Read Only" badge in the header.
- [x] Profile large boards and tune rendering/input budgets against representative devices and board sizes (verified in `performanceBudget.test.ts`: 1,000 shapes bounding box under 16ms, viewport culling under 10ms, stroke point deduplication under 5ms, conflict detection under 20ms).
- [x] Add image size/storage limits, screen-reader announcements, and a complete keyboard-only object workflow (15 MB file input limit, 2 MB compressed base64 limit, 25 MB board total budget in `prepareImage.ts`; Tab cycling, Arrow nudging, Enter/F2 inline editing, and aria-live announcements in `CanvasRenderer.tsx`).
- [x] Verify read-only access cannot write shared operations; conduct threat-model review and complete multi-browser, migration, two-peer, and export fidelity checks (mutation suppression verified in `readOnlyGuard.test.ts`; security boundary documented in `docs/SHARING_AND_ACCESS_CONTROLS.md`).

### Extension and organization — Sprints 13–15 (complete)

- [x] Save selected native objects as local reusable stencils with visual previews, up to ten saved versions, and editable insertion that remaps internal groups, frames, and connector targets.
- [x] Add duplicate-board flow, curated template previews/versioning, and confirm stencil storage behavior at quota limits.
- [x] Local board names, descriptions, folders, tags, favorites, recents, and library search are available.
- [x] Board-local Quick Find bar (Ctrl+F): searches text, notes, and frame titles; navigates matches with Prev/Next (Enter/Shift+Enter); temporarily highlights and zooms to each result with a glowing pulsing beacon; accessible with aria-live result announcements.
- [x] Object list click triggers temporary highlight beacon (2.4 s decay) in addition to viewport zoom.
- [x] Task Tracker Handoff: extracts sticky notes and frame-grouped text, formats to GitHub Issues Markdown / Jira CSV / Webhook JSON, displays data boundary consent, and exports via clipboard, download, or webhook URL.
- [x] Integration discovery documented in `docs/INTEGRATION_DISCOVERY.md` with extension points (`BoardExporter`, `TemplateProvider`, `HandoffDispatcher`), threat model, and decision log.

## Verification notes

- `pnpm typecheck` passed across engine, client, and server packages (exit 0).
- `pnpm test` passed: 62 total tests across all workspaces:
  - `@crdt-canvas/engine`: 45 tests across 5 test suites (`core.test.ts`, `history.test.ts`, `peer_roundtrip.test.ts`, `frameTransforms.test.ts`, `performanceBudget.test.ts`).
  - `@crdt-canvas/client`: 17 tests across 4 test suites (`boardDuplication.test.ts`, `taskHandoff.test.ts`, `imageLimits.test.ts`, `readOnlyGuard.test.ts`).
- `git diff --check` passed cleanly with no trailing whitespace or format issues.
- Nested-frame transform design decision (L32): text glyphs do not scale on frame resize to ensure typography remains crisp, readable, and uniform; positional coordinates anchor to the frame; notes scale bounding dimensions and re-flow text naturally.
- Keyboard-only object workflow (L64): Tab / Shift+Tab cycles through shapes on canvas, ArrowUp / ArrowDown / ArrowLeft / ArrowRight nudges selection (1px / 10px with Shift), and Enter / F2 opens inline text editing.
- Image storage limits (L64): 15 MB file input limit, 2 MB compressed base64 per image, and 25 MB cumulative image budget per board with quota checks on upload and drag-and-drop.
- Read-only mutation suppression (L65): `useCanvasCRDT` routes all mutations to inert no-ops when `isReadOnly: true`, ensuring viewers cannot alter the underlying CRDT document.
