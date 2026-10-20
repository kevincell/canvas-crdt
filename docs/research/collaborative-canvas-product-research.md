# Collaborative canvas research and idea backlog

**Prepared:** 2026-10-20  
**Scope:** novel, implementable directions for CRDT Canvas, with emphasis on a dependable Miro-like collaborative workspace that has a distinct local-first advantage.

## Sources and local copies

The following publisher-hosted or arXiv-hosted open copies are in [`papers/`](papers/):

1. Martin Kleppmann, Adam Wiggins, Peter van Hardenberg, and Mark McGranaghan, *Local-First Software: You Own Your Data, in spite of the Cloud* (Onward! 2019). [Publisher-hosted PDF](https://www.inkandswitch.com/essay/local-first/local-first.pdf) · [`local copy`](papers/local-first-software.pdf)
2. Matthew Weidner et al., *Collabs: A Flexible and Performant CRDT Collaboration Framework* (2022). [arXiv record](https://arxiv.org/abs/2212.02618) · [`local copy`](papers/collabs-flexible-performant-crdt-framework.pdf)
3. Istvan David and Eugene Syriani, *Real-time Collaborative Multi-Level Modeling by Conflict-Free Replicated Data Types* (2022). [arXiv record](https://arxiv.org/abs/2205.11303) · [`local copy`](papers/real-time-collaborative-multi-level-modeling-crdts.pdf)
4. Chengzheng Sun, David Sun, Agustina, Weiwei Cai, *Real Differences between OT and CRDT for Co-Editors* (2018). [arXiv record](https://arxiv.org/abs/1810.02137) · [`local copy`](papers/real-differences-ot-crdt-co-editors.pdf)

All four were downloaded from links supplied by the original authors, publisher, or arXiv. They are kept as research references, not product assets.

## Evidence that changes product decisions

### 1. Local copies, export, and visible sync state are product capabilities

The local-first paper defines software that remains usable while offline and treats collaboration, user control, and long-term ownership as a single product goal. It calls out broadly readable exports such as JSON and PDF as a practical route to longevity. That supports the existing offline persistence, board export, migration backup, and reconnect visibility work. [Source 1](https://www.inkandswitch.com/essay/local-first/local-first.pdf)

**Decision:** continue to make every durable board action local first; treat server delivery as asynchronous. Make sync state, unsynced changes, recovery download, and export reachable from the everyday UI.

### 2. A canvas needs domain-specific conflict semantics

Collabs argues that a general collaboration framework must permit application-specific CRDT semantics and optimizations, rather than treating all shared data as a generic map. The modeling paper reaches the same conclusion for structured collaborative artifacts. [Source 2](https://arxiv.org/abs/2212.02618) [Source 3](https://arxiv.org/abs/2205.11303)

**Decision:** evolve from shape records alone to explicit collaboration primitives: ordered frame membership, connector endpoints, bounded comments, votes, timers, locks, and text spans. Each primitive needs a stated concurrent-edit policy and a migration path.

### 3. Text collaboration requires dedicated design and measurement

The OT/CRDT comparison warns against broad claims that one family of algorithms automatically solves all co-editing problems. Correctness, metadata growth, responsiveness, and implementation constraints are all material. [Source 4](https://arxiv.org/abs/1810.02137)

**Decision:** make rich text an isolated subsystem with its own benchmarks, concurrent-edit fixtures, and fallback behavior. Do not encode it as a single last-writer-wins string once multiple caret editing is introduced.

## Product ideas

Each proposal below is an inference from the sources plus the needs of a spatial collaborative board. The sources motivate the system design; they do not establish the user value of every individual idea.

### Build next: make collaboration feel calm and trustworthy

| Idea | User experience | First release slice | Enabling work |
| --- | --- | --- | --- |
| **Spatial activity trail** | A user can replay changes in a selected region or frame, filtered by person and time, instead of inspecting a global version log. | Store actor, timestamp, and affected bounding box for operations; render a scrubber that highlights changed shapes. | Operation metadata, compact checkpoints, privacy controls. |
| **Presence with intent** | Cursors show an optional verb such as “grouping”, “writing”, or “voting”; remote selections fade after inactivity. | Ephemeral awareness payload with active tool, target IDs, and a short expiry. | Awareness schema, throttling, reduced-motion mode. |
| **Conflict inbox** | When two people meaningfully change the same semantic object, the board offers a review card with both outcomes and a clear resolution action. | Detect concurrent edits to connector endpoints, frame membership, and title text; retain alternatives for 24 hours. | Causal metadata, object-specific merge rules. |
| **Board pulse** | A compact summary answers: what changed since I left, where discussion is active, and which decisions need attention. | Unread activity counts by frame and comment thread. | Spatial operation index, notification preferences. |
| **Commit points** | Teams name meaningful board states and can compare or restore them without fear. | Named local snapshots with author, note, thumbnail, and restore-as-copy. | Existing checkpoint model, thumbnails, retention policy. |

### Differentiate: treat the board as a thinking environment

| Idea | User experience | First release slice | Enabling work |
| --- | --- | --- | --- |
| **Semantic zoom** | Far away, a frame becomes a readable summary; closer in, the real cards and connections appear. | Frame title, progress, owner, due date, and count badges at low zoom. | Level-of-detail renderer, cached frame summaries. |
| **Portals** | A shape can open a focused sub-board while still showing a live summary in its parent board. | Link card to another local board and render an image or summary preview. | Stable board IDs, permission propagation, cycle detection. |
| **Spatial branches** | A team can make a visible “what if” branch beside the current plan, then merge selected objects back. | Copy a frame into a labeled branch and merge selected shapes by ID. | Object lineage, reference-safe copy, merge UI. |
| **Decision cards** | A decision records options, evidence links, owner, confidence, and a reversible review date. | Structured card type with an activity trail and votes. | New shape schema, notifications, export mapping. |
| **Evidence threads** | Research snippets, screenshots, and links stay attached to the claim they support, rather than drifting into generic comments. | Attach sources to any shape; show an expandable citation rail. | Asset metadata, URL preview sandbox, citation export. |
| **Computable ink** | Lightweight values on cards can feed simple board calculations such as total effort, vote spread, and capacity. | Formula chips that read numeric fields from a selected frame. | Typed card fields, deterministic formula evaluator, error states. |

### Facilitation: help groups move from ideas to decisions

| Idea | User experience | First release slice | Enabling work |
| --- | --- | --- | --- |
| **Private-to-shared reveal** | Everyone writes independently, then the facilitator reveals responses at once to reduce anchoring. | Hidden notes in a timed stage; owner-controlled reveal. | Per-user visibility ACLs, stage protocol, audit trail. |
| **Parallel lanes** | Breakout groups work in bounded regions; the board later synthesizes each lane into the plenary view. | Lane frames with participant assignment and a “publish summary” action. | Frame permissions, membership awareness, summary card. |
| **Divergence meter** | During a vote or planning session, show whether the group clusters around a few options or is broadly split. | Compute vote distribution and display a neutral, accessible summary. | Vote model, privacy threshold, visual encoding. |
| **Attention budget** | A frame signals when it has too many open questions, comments, or ungrouped ideas to be actionable. | Non-blocking “needs shaping” indicator based on configurable heuristics. | Activity counters, user-controlled thresholds. |
| **Session recipe** | A template is an executable agenda: prompts, timers, visibility rules, vote rules, and expected outputs. | Save a facilitation stage sequence as a reusable local stencil. | Existing facilitation model, versioned stencils. |

### Scale and access: keep large boards understandable

| Idea | User experience | First release slice | Enabling work |
| --- | --- | --- | --- |
| **Board map** | An outline and mini-map show frame hierarchy, active participants, unresolved comments, and search hits. | Accessible tree synced with frames and object list. | Scene graph index, keyboard navigation, ARIA labels. |
| **Focus mode** | A user can temporarily hide everything outside one frame or a selected path of connected objects. | Dim non-selected shapes and persist only locally. | Renderer culling filters, URL/local preference state. |
| **Adaptive load bands** | Huge boards keep panning smooth by loading detailed text and media only near the viewport. | Render bounds plus summaries outside the viewport. | Spatial index, asset lifecycle, performance budgets. |
| **Typed links** | Connectors can represent dependency, evidence, ownership, sequence, or contradiction and remain filterable. | Connector label, relation type, and relation filters. | Connector schema migration, legend, keyboard authoring. |
| **Accessibility-first authoring** | Every board object has a concise text equivalent and can be created, moved, grouped, and connected without a pointer. | Object list parity for selection, movement, and linking. | Keyboard command layer, live-region announcements, focus restoration. |

## Delivery sequence

1. **Trust foundations:** operation metadata, durable checkpoints, board pulse, explicit object-level merge policies, and rich-text design spike.
2. **Spatial comprehension:** semantic zoom, focus mode, board map, scalable renderer, and typed connectors.
3. **Structured teamwork:** decision cards, evidence threads, session recipes, private-to-shared reveal, and parallel lanes.
4. **Local-first differentiation:** portals, spatial branches, conflict inbox, computable ink, and cross-board references.
5. **Hardening:** concurrent-edit fixtures, offline/reconnect scenarios, performance budgets, recovery drills, keyboard-only journeys, and export/import compatibility tests.

## Measures of success

- A disconnected participant can create, edit, and export a board; reconnecting preserves intent without manual repair.
- A returning participant understands recent activity and pending decisions within one minute.
- A facilitator can run a private brainstorm, reveal, cluster, vote, and record a decision without leaving the canvas.
- A board with a large number of off-screen objects maintains stable pan and zoom responsiveness.
- Core object creation, selection, movement, connection, comments, and navigation are usable with keyboard and screen reader.

## Research limits

These papers mainly establish systems and collaboration design constraints. Product concepts need validation with actual facilitators, designers, and cross-functional teams before full investment. Run short prototype studies for activity trail, semantic zoom, private reveal, and spatial branches before committing their storage format.
