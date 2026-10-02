# Sharing, Access Controls & Threat Model

This document captures the threat model, trust assumptions, permission architecture, and defense-in-depth measures for board sharing in `@crdt-canvas`.

---

## 1. Threat Model & Topology

`@crdt-canvas` operates on a **local-first, peer-to-peer (P2P) WebRTC synchronization** model with an ephemeral signaling server used solely for SDP exchange and peer discovery.

### Threat Actors & Capabilities

| Actor | Access Level | Capabilities & Bounds |
|---|---|---|
| **Editor** | Full Write | Possesses room ID. Broadcasts Yjs document updates, awareness states, and ephemeral lasers/comments. |
| **Viewer** | Read-Only | Possesses room ID with viewer token/role. Receives document updates and presence; local mutations are suppressed. |
| **Signaling Relay** | Untrusted Transport | Assists in ICE candidate exchange. Does not store, persist, or decrypt CRDT documents. |
| **Network Passive Observer** | Eavesdropper | WebRTC DTLS-SRTP encryption prevents eavesdropping on media and data channels between peers. |

---

## 2. Permission Matrix

| Capability | Editor (`role=editor`) | Viewer (`role=viewer`) | Presenter (`role=viewer&present=true`) |
|---|:---:|:---:|:---:|
| Pan & Zoom Viewport | Yes | Yes | Yes |
| Real-time Updates (receive) | Yes | Yes | Yes |
| Inspect Shape Bounds & Text | Yes | Yes | Yes |
| Frame Presentation Navigation | Yes | Yes | Yes (Auto-opened) |
| Export PNG / PDF / JSON / Tasks | Yes | Yes | Yes |
| Search Objects & Find Bar | Yes | Yes | Yes |
| Draw / Create Shapes | Yes | **Blocked** | **Blocked** |
| Move / Resize / Delete Shapes | Yes | **Blocked** | **Blocked** |
| Text / Note Editing | Yes | **Blocked** | **Blocked** |
| Undo / Redo Execution | Yes | **Blocked** | **Blocked** |
| Template / Stencil Insertion | Yes | **Blocked** | **Blocked** |
| Conflict Overrides | Yes | **Blocked** | **Blocked** |
| Dot Voting | Yes | **Blocked** | **Blocked** |

---

## 3. Defense-in-Depth Implementation

Access control in a client-side P2P network employs layered defense-in-depth:

### Layer 1: UI Gating & Affordances
- In `SingleCanvasView`, when `isReadOnly` is active:
  - Header displays a distinct **Viewer (Read-only)** visual pill.
  - Toolbar is dynamically streamlined: drawing tools, color pickers, opacity/radius sliders, and undo/redo buttons are hidden or replaced with an explicit `READ ONLY` badge.
  - Template insertion modal and starter cards are suppressed.

### Layer 2: Interaction Interception
- In `CanvasRenderer`:
  - `handleMouseDown`: Rejects drawing actions (`stroke`, `rect`, `ellipse`, `line`, etc.). Handle resizing (`getHandleAt`) is disabled. Object dragging is suppressed.
  - `handleDoubleClick`: Inline text and note editor overlays do not trigger.
  - Drag-and-drop file ingestion (images/JSON) is rejected.

### Layer 3: Engine-Level Mutation Guards
- In `useCanvasCRDT`:
  - When `isReadOnly: true`, all mutation dispatches (`createStroke`, `createRect`, `createEllipse`, `createLine`, `createText`, `createImage`, `createNote`, `updateShape`, `deleteShape`, `commitShapeHistory`, `commitShapeHistoryBatch`, `resolveConflict`, `undo`, `redo`) are routed to inert no-ops.
  - Even if a malicious user executes JavaScript in developer tools, local mutating invocations cannot write updates to the Yjs transaction queue.

### Layer 4: Awareness & Presence Disclosure
- The client broadcasts `role: 'viewer'` in the Yjs awareness state. Remote peers can visually distinguish viewers from active co-editors.

---

## 4. Cryptographic Roadmap for Hostless Rooms

For future deployments requiring cryptographic enforcement against actively compromised clients that bypass client-side code:
- **Asymmetric Document Signing:** Editors hold an Ed25519 signing key for the room; update payloads are cryptographically signed before being accepted into the Yjs doc.
- **Read Keys vs. Admin Keys:** Rooms use hash-derived keys (`hash(admin_key) = read_key`) so viewers possess the decryption key for CRDT data but cannot forge signed write operations.
