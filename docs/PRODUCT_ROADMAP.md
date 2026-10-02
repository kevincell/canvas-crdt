# CRDT Canvas: Agile Product Roadmap

## Product intent

Evolve the current collaborative drawing prototype into a dependable visual workspace for brainstorming, planning, and presenting. The target experience should feel immediate and forgiving: people can create and edit content without fighting tools, see collaborators clearly, recover from mistakes, and trust that a board will still be there when they return.

This roadmap borrows familiar interaction patterns from visual collaboration products such as Miro. It does not assume feature or technical parity with any one product. The current differentiator remains transparent, offline-first collaboration and understandable conflict handling.

## Product outcomes

1. **Create without friction:** drawing, text, notes, shapes, and images have predictable tools and keyboard access.
2. **Keep meaning intact:** colour, text, dimensions, ordering, and edits remain consistent across peers and reloads.
3. **Collaborate with confidence:** presence, reconnect, undo, permissions, and recovery are clear and dependable.
4. **Organize ideas:** groups, frames, connectors, search, and templates make large boards usable.
5. **Share the result:** export, presentation, and guest access make a board useful beyond its creators.

## Delivery approach

- Work in two-week sprints, with a one-week hardening/release sprint after each three delivery sprints.
- Keep a shippable increment at the end of every sprint. Release behind a feature flag when operational dependencies are not ready.
- Keep the board engine independent from UI details. Every shared change must have deterministic data semantics and a versioned migration story.
- Use discovery spikes for uncertain or high-risk work (especially CRDT semantics, persistence, export, and access control). A spike ends with a decision record and a thin working prototype.
- Order backlog items by user value, risk retired, and dependency. Do not start an item until its acceptance criteria and failure states are clear.
- During planning, reserve roughly 20% of team capacity for defects, accessibility, performance, and unexpected integration work.

### Suggested team and cadence

A small product team can cover this plan with a product owner, designer/researcher, two client engineers, one collaboration/platform engineer, and a shared quality engineer. Roles can be combined for a smaller team. Each sprint has planning, daily coordination, a mid-sprint review of risky work, demo/review, and a retrospective. A release captain owns the release checklist and rollback.

### Definition of Ready

A backlog item is ready when it has a user or reliability outcome, a named owner, acceptance criteria, UX states (including empty/loading/error states), data and migration impact, dependencies, and a size small enough to finish within a sprint. Unproven CRDT or performance assumptions must be identified before implementation.

### Definition of Done

An item is done when its behavior is implemented, reviewed, accessible by keyboard where applicable, responsive at supported sizes, compatible with existing room data, covered by focused automated checks, and demonstrated on a clean local board. Shared editing must be checked with two peers and a reconnect path. Instrumentation and user-facing help are included when they materially affect supportability. No known release-blocking defect remains.

## Agile release roadmap

Each sprint lists a goal, the valuable increment, and a completion check. Sprint contents are a planning baseline; the product owner may reorder work between sprints as discovery changes the evidence.

### Phase 0 — Product and technical baseline (Sprint 0, 1 week)

**Goal:** make the current prototype measurable and establish the smallest safe delivery loop.

- Inventory the current shape model, UI flows, persistence lifetime, collaboration transport, and known failure modes.
- Record baseline measures: first-board time, draw-to-render latency, board size, reconnect time, and recovery after reload.
- Define supported browsers, input devices, accessibility expectations, room lifecycle, and data retention assumptions.
- Agree on a stable design vocabulary for tool, selection, zoom, active colour, and text editing.
- Add reproducible local environments and a smoke checklist for one peer and two peers.

**Acceptance:** the team can start two clients against one room, create content, reload, reconnect, and capture baseline timings from a written checklist. All current critical bugs have owners and reproducible steps.

### Phase 1 — Trustworthy canvas basics (Sprints 1–3)

#### Sprint 1: Colour and text foundation

**Goal:** make basic content look and behave the same wherever it is created.

- Use one active colour source for strokes, lines, shapes, text, and new note backgrounds; calculate readable note text contrast.
- Support custom colour input and ensure fills use valid colour conversion rather than string suffix tricks.
- Support multi-line text, sensible text bounds, commit/cancel behavior, and editing existing text and notes.
- Standardize baseline, font size, wrapping, selection bounds, and zoom behavior for text.

**Acceptance:** a user-selected colour is visibly applied to each supported tool, including custom hex colours. Text with multiple paragraphs round-trips between peers and remains editable after creation.

#### Sprint 2: Selection and manipulation

**Goal:** make object editing discoverable and predictable.

- Improve hit testing for thin lines, strokes, and text; keep the topmost object selectable.
- Add clear selection state, resize handles, move/resize cursor feedback, and escape-to-deselect.
- Add duplicate, delete, and basic object-level colour changes.
- Add shift-click multi-select and predictable selection persistence during toolbar use.

**Acceptance:** users can select, move, resize, recolour, duplicate, and delete supported shapes with mouse and keyboard. Edits converge on two peers and undo restores the previous state.

#### Sprint 3: Navigation, shortcuts, and input reliability

**Goal:** make boards comfortable to explore at all sizes.

- Add space+drag panning, trackpad gestures, fit-to-content, zoom-to-selection, and zoom-to-cursor.
- Handle pointer capture, touch input, lost pointer-up events, and browser focus changes without leaving tools stuck.
- Publish an in-app shortcut map and make shortcuts ignore form fields and editable text.
- Improve small-screen layout by moving the crowded toolbar into a compact tool dock.

**Acceptance:** navigation remains centered around the pointer; a user can recover from interrupted gestures; core drawing and selection flows work with keyboard and touch.

### Phase 2 — Board authoring and structure (Sprints 4–6)

#### Sprint 4: Shape palette and visual styles

**Goal:** let users communicate structure, not just draw outlines.

- Add fill, border colour, border width, opacity, and corner radius controls with consistent defaults.
- Add arrows, connectors, and basic line/connector endpoint attachment.
- Add alignment guides, snap-to-grid, equal spacing hints, and optional grid visibility.
- Preserve arrowheads, styles, and endpoint intent in the shared shape model.

**Acceptance:** shapes render identically on every peer, remain legible at common zoom levels, and snap can be toggled without altering the underlying stored coordinates unexpectedly.

#### Sprint 5: Grouping, layers, and frames

**Goal:** keep growing boards understandable.

- Add multi-select grouping/ungrouping with group move and duplicate.
- Add send forward/backward and a minimal layers panel with hide/lock controls.
- Add frames as named regions with fit-to-content and stable child membership semantics.
- Make selection bounds and hit testing group-aware.

**Acceptance:** grouped items stay together across peer updates, locked items cannot be accidentally moved, and frame operations do not destroy child content.

#### Sprint 6: Notes and facilitation

**Goal:** make the canvas useful for structured group activities.

- Add sticky note resizing, colour families, quick-add by keyboard, and batch note creation.
- Add voting dots, timer, and lightweight activity modes (brainstorm, affinity grouping, retrospective).
- Add a tidy-up command for selected notes with deterministic ordering and undo.
- Make all facilitation features opt-in and usable without account state.

**Acceptance:** a facilitator can create a cluster of notes, run a timed vote, and keep or undo the resulting organization. Participant actions and board edits sync or fail visibly.

### Phase 3 — Reliable collaboration and recovery (Sprints 7–9)

#### Sprint 7: Persistence and room lifecycle

**Goal:** make a board survive refreshes, offline use, and room re-entry.

- Define board identity separately from ephemeral room signaling.
- Add persistence status, storage quota handling, IndexedDB initialization feedback, and a recoverable local snapshot.
- Add board rename, recent boards, explicit create/join flows, and duplicate-board recovery.
- Define schema versions and safe migrations for stored shapes.

**Acceptance:** reload and temporary offline use do not lose acknowledged local work. The UI explains whether data is local, synced, or waiting for a peer.

#### Sprint 8: Collaboration presence and communication

**Goal:** make shared activity legible.

- Improve collaborator list, cursor labels, follow-presenter, and participant identity colours.
- Add anchored comments and @mentions as separate discussion records rather than destructive shape edits.
- Add reactions and resolve/reopen states for comments.
- Add optional user-facing sync diagnostics with copyable support details.

**Acceptance:** comments remain anchored when the board pans or zooms and can be resolved without editing the referenced shape. Presence fades cleanly after disconnect.

#### Sprint 9: Undo, history, and conflict clarity

**Goal:** let users recover safely and understand concurrent outcomes.

- Audit undo grouping for drag, resize, text edit, recolour, group, and delete.
- Separate personal undo from shared history semantics and document them in the UI.
- Improve conflict classification so repeated recomputations do not create duplicate warnings or unstable timestamps.
- Add named checkpoints, restore-as-copy, and readable change summaries.

**Acceptance:** each user action is undone as one understandable unit; history replay is deterministic for a fixed document; conflict notices explain the affected object and available action.

### Phase 4 — Scale, access, and quality (Sprints 10–12)

#### Sprint 10: Performance and large boards

**Goal:** keep editing smooth as boards grow.

- Profile rendering at representative board sizes and remote update rates.
- Add spatial indexing for hit testing and visible-region rendering.
- Reduce allocations in render loops, cache stable geometry, and coalesce high-frequency awareness updates.
- Add board-size guidance and graceful image storage limits.

**Acceptance:** agreed performance budgets hold for a representative large board on supported mid-range devices. Dragging remains responsive while remote edits arrive.

#### Sprint 11: Accessibility and product polish

**Goal:** make core board work inclusive and understandable.

- Add labelled toolbar controls, visible focus, contrast review, reduced motion, and screen-reader announcements for important board actions.
- Add keyboard selection traversal and an accessible object list with rename/edit/delete actions.
- Improve onboarding, empty states, connection errors, confirmations for destructive actions, and contextual help.
- Run moderated usability sessions with first-time users and prioritize observed blockers.

**Acceptance:** core flows can be completed without a mouse; critical controls meet agreed contrast and focus requirements; new users can join and make a first note without coaching.

#### Sprint 12: Sharing, export, and release hardening

**Goal:** make a board useful outside the live editing session.

- Add PNG and PDF export, selection export, and a presentation view with frame navigation.
- Add read-only sharing links and explicit access controls after threat-model review.
- Add final multi-browser, reconnect, reload, and migration verification.
- Publish release notes, support guidance, backup/restore instructions, and rollback procedure.

**Acceptance:** exported output matches the visible board and supports large canvases; read-only access cannot write shared operations; release checklist and rollback path are demonstrated.

### Phase 5 — Extension and product differentiation (Sprints 13–15)

#### Sprint 13: Templates and reusable components

**Goal:** help teams start from useful patterns.

- Add curated board templates and sample content.
- Add user-created reusable groups/stencils with safe paste/import semantics.
- Add template preview, versioning, and board duplication.

**Acceptance:** a template creates editable native objects and can be duplicated without sharing accidental live state with its source.

#### Sprint 14: Search and board organization

**Goal:** make information findable.

- Add board title/description, folders or workspaces, recent/favourite boards, and board search.
- Search text and notes, navigate to a result, and highlight it temporarily.
- Add tags and a small set of board metadata filters.

**Acceptance:** search results remain local to the selected board/workspace and navigation takes the viewport to the correct object or frame.

#### Sprint 15: Integrations and extensibility discovery

**Goal:** test which integrations create real user value before expanding the surface area.

- Run discovery on import formats, task tracker handoff, and presentation workflows.
- Prototype one integration with clear user consent and explicit data boundaries.
- Document extension points for import/export and external identity without embedding provider assumptions in the canvas engine.

**Acceptance:** one measured workflow reduces user effort without weakening board access or offline behavior. Continue, revise, or stop each integration based on evidence.

## Product backlog themes

These are persistent epics across the sprint plan, not commitments to start all at once:

| Epic | User value | Main risks |
|---|---|---|
| Canvas interaction | Fast, precise creation and editing | Pointer edge cases, hit testing, touch ergonomics |
| Visual consistency | Predictable colour, typography, and object styling | Legacy board compatibility, contrast |
| Board structure | Groups, frames, connectors, layers | Stable CRDT ordering and membership semantics |
| Collaboration | Presence, comments, reconnect, shared review | Awareness load, identity, stale participants |
| Recovery | Undo, snapshots, checkpoints, history | Shared undo intent and migration safety |
| Scale | Large-board rendering and image handling | Memory growth, P2P update volume |
| Accessibility | Keyboard, screen reader, contrast, reduced motion | Canvas needs parallel accessible object model |
| Sharing | Export, presentation, controlled read-only access | Privacy, export fidelity, access control |

## Risk register and response

- **Concurrent edits to rich objects:** define whether fields merge independently, use last-writer-wins, or create a visible conflict before expanding the model. Prototype multi-peer cases first.
- **Persisted schema drift:** version shape and board data; migrate copied snapshots before opening a board; retain a recovery copy until migration succeeds.
- **P2P connection limits:** measure room size and message volume; define when signaling, relay, or a hosted persistence service is needed without changing the local-first contract silently.
- **Canvas accessibility:** provide an accessible semantic object list and actions instead of treating pixels as the only interface.
- **Image payload growth:** establish per-image and per-board limits, explain failures, and evaluate blob storage separately from shape metadata.
- **Scope growth:** keep every sprint to a demonstrable user outcome, move stretch work back to backlog, and protect hardening capacity.

## Release gates and health measures

Track progress with a small dashboard: first successful board action, save/reload recovery, reconnect success, remote cursor freshness, p95 interaction latency, crash-free sessions, defect reopen rate, accessibility blockers, and weekly active boards. Set numeric budgets after the Phase 0 baseline rather than inventing targets before measurement.

A release candidate must pass the supported-browser smoke checklist, two-peer sync and reconnect, reload recovery, schema migration, keyboard-only core flow, export spot checks where applicable, and no open severity-one or severity-two defect. Roll out incrementally and keep a tested rollback path for persistence and schema changes.
