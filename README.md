# CRDT Canvas

A peer-to-peer, offline-first collaborative whiteboard — part MS Paint, part MS Word — with a synced
Watch Party for music, video and screen sharing. Built on Conflict-free Replicated Data Types (Yjs),
direct WebRTC replication and semantic conflict detection.

> **Academic novelty**: semantic conflict handling for a shared 2D canvas — a union-bounding-box merge
> rule for concurrent resizes, consensus-free intent-ambiguity detection, and an auditable conflict &
> checkpoint log with before/after snapshots — all without an authoritative server.

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
┌─────────────┐      WebRTC data channels (direct P2P)      ┌─────────────┐
│   Peer A    │ ◄──────────────────────────────────────────► │   Peer B    │
│  (Browser)  │                                              │  (Browser)  │
└──────┬──────┘                                              └──────┬──────┘
       │ IndexedDB (offline-first)                                  │ IndexedDB
       ▼                                                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Room document   "<roomId>::room"                                         │
│   meta · members · join declines · boards list · votes · chat ·          │
│   Watch Party channels (media broadcasts, screen-share signalling)       │
├──────────────────────────────────────────────────────────────────────────┤
│ Board documents (one per board)  "<roomId>::b::<boardId>"                │
│   shapes (Y.XmlElement) · checkpoints · conflict log · comments ·        │
│   snapshots (de-duplicated, images stored once)                          │
└──────────────────────────────────────────────────────────────────────────┘
       ▲  WebSocket — signalling ONLY (peer discovery, SDP / ICE)      ▲
       └───────────────────────┬────────────────────────────────────────┘
                      ┌────────┴────────┐
                      │ Signaling server│  :3001  (+ /api/ip, /api/time)
                      └─────────────────┘
```

- **No authoritative server** — the Node server only introduces peers. Drawings, chat, votes and media
  control messages travel browser-to-browser.
- **Offline-first** — every room and board is stored in IndexedDB. Draw with no network; changes merge
  automatically when peers reconnect.
- **Rooms hold boards** — a new room starts with one empty board; *New board* adds another without
  touching the existing ones. Boards created before rooms existed are adopted automatically.

---

## Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 18, TypeScript, HTML5 Canvas | Board rendering & interaction, panels |
| Styling | MUI + CSS variables | Per-device day / night theme (pastel café-and-garden palette by day, low-glare night palette) |
| CRDT | Yjs, y-protocols Awareness | Shared state, presence, cursors, lasers |
| P2P transport | y-webrtc / simple-peer | Direct replication + screen-share streams |
| Signalling | Node.js, `ws` | Discovery, LAN IP and clock endpoints |
| Persistence | IndexedDB (`y-indexeddb`) | Local copy of every room & board |
| Testing | Vitest, Playwright | Engine + client unit tests, e2e |

---

## What you can do

### Look and feel
Day / night toggle per device: a pastel café-and-garden palette (sage greens, latte browns, cream canvas) by
day and a low-glare moss-and-bark palette at night — applied to every screen, panel, dialog and the Watch Party.
Dark ink is shown light on the night canvas so drawings stay visible to peers using the other theme.

### Board tools (left rail)
| Tool | Key | What it does |
|---|---|---|
| Select (cursor) | V | Pick one object; drag to move, round handles to resize, Shift-click to add |
| Hand (box select) | H | Drag a translucent blue box to select many objects; drag the box to move the group, its corners to resize |
| Pen | P | Freehand strokes (one clean line style) |
| Line / arrow | L | Straight line with no arrow, end arrow or both; ends attach to shapes |
| Rectangle / Ellipse | R / O | Shift for square / circle; corners pointed or rounded |
| Text box | T | Click or drag a box and type — Arial or Times New Roman |
| Image | I | Place, drop or paste PNG / JPEG / WebP / GIF |
| Fill | F | Fill a closed shape (rect, ellipse, text box, closed pen shape) |
| Eraser | E | Partial erase of pen strokes, like a pencil eraser — sizes S / M / L |
| Delete | D | Remove a whole object |
| Laser | K | Glowing tip with a fading tail in your pointer colour (not saved) |

**Selection bar** (appears above any selection, like Word's mini toolbar): colour, fill, thickness,
line style (solid, dashed, dots with small or long gaps), corners, opacity, font & size, − / + resize,
comment, lock, delete. With the hand tool, *Text box* turns the blue box into a text box of the same size.

Zoom with the wheel / pinch or the **+ / −** buttons. Undo / redo with Ctrl+Z / Ctrl+Y.

### Rooms, people and boards
- **Create / join** — creating makes you host. Anyone joining waits until an approved member (host *or*
  any member, so it works when the host is offline) presses **Allow** or **Decline**. (Basic admission
  only — not a security boundary.)
- **Room details** (top right): room ID and name, description, everyone with their pointer-colour dot and
  online state, boards list (open / rename / delete), open votes, leave room. Host can kick (their work
  stays) and start a *delete room* vote.
- **You** (avatar): name, pointer & laser colour, rooms you've joined (click to switch), day / night.
- **Share**: a *view-only* link (just the live drawing, no tools) and an *edit* link (full tools, needs approval).
- **Comments** attach notes to selected objects; **Chat** is room-wide.
- **Templates** (2 demo layouts), **Export** PNG / PDF (board or selection).
- **Multiple boards** per room: board switcher next to the room name; *New board* adds an empty board
  without touching the others. Rooms and boards both have a name and description.
- **Waiting screen** tells a joiner what's happening: how many members are online and can approve,
  "no member online yet", "can't reach the signalling server", or "this browser is already in the room".
- **About** panel lists every icon with its name and meaning.

### People, presence and online status
- **One browser = one person.** Each browser keeps a permanent device ID; your name is only a label, so
  renaming (e.g. Ruby → Ethan) on the same browser updates the same member instead of adding a new one.
- **Tabs** of the same browser count as one person — shown once in counts and lists, and your own other tabs
  don't appear as extra cursors or lasers. (Each tab is still its own CRDT replica underneath, which merging needs.)
- **Different browsers, incognito windows and other devices** are different people.
- **Test mode:** a tab opened with `?guest=1` gets its own identity, so one person can test as two in one browser.
- Top-bar status: **"N on this board"**, **"Online · only you here"** (server reachable, nobody else yet) or
  **"Offline · saved locally"** (server unreachable — edits are kept and merge on reconnect).

### Locks and votes (room governance)
| Action | Needs |
|---|---|
| Delete a board (its creator asks) | ≥ ¼ of active members |
| Delete the room (host asks) | ≥ ¼ of active members |
| Unlock objects | > ½ of active members |
| Delete locked objects | > ½ of active members |
| Revert a board to a checkpoint | > ½ of active members |

Active members = approved, not removed, seen in the last 7 days. Votes expire after 24 h. Every peer
evaluates the same shared vote record, so results are identical everywhere. This governance layer sits
**on top of** the CRDT — the conflict detection below needs no voting or consensus.

### Watch Party
Play a YouTube link or a local audio / video file (uploaded to the local server and streamed to everyone on
the Wi-Fi / hotspot, no internet needed), or share your screen / tab with audio. One peer hosts, the others
follow in sync.

- Shared server clock + host heartbeat + smooth speed nudging keep listeners within about **±0.05 s**.
- Host: play / pause / seek for everyone, ±10 s, previous / next, loop, autoplay, speed, subtitles (`.srt` / `.vtt`).
- Listeners: own volume, pause, ±10 s just for me, *Sync to Host*, personal speed, captions, live drift readout.
- Views: floating dock, draggable minimised pill (always on top of panels), theatre, full screen.
- Belongs to the **room**: keeps playing while you switch boards in the same room; leaving the room or switching
  to another room stops what you were hosting, so nothing carries over between rooms.

---

## Novel Academic Contributions

### 1. Union-Bounding-Box Merge Rule for Concurrent Resizes
Last-Write-Wins silently discards one person's resize. When two concurrent resizes of the same shape are
detected, the engine merges them as the union of both boxes:

$$\text{Box}_{\text{merged}} = [\min(x_{A1}, x_{B1}), \min(y_{A1}, y_{B1}), \max(x_{A2}, x_{B2}), \max(y_{A2}, y_{B2})]$$

The rule is commutative, associative and idempotent, so all replicas converge without losing either
participant's intent. Each auto-merge is now also written to the conflict log (as resolved) with
before / after snapshots and a merge checkpoint.

### 2. Intent Ambiguity Detection (Consensus-Free)
A pure function evaluated identically on every peer:

$$\text{Ratio} = \frac{\|\text{Center}_A - \text{Center}_B\|}{\max(\text{Size}_A, \text{Size}_B)}$$

- Ratio < 0.1 → None · 0.1 – 0.5 → Low · 0.5 – 1.5 → Medium · ≥ 1.5 → High

Because it runs over the same CRDT state, all peers raise the same flag with no extra network rounds.
Resolution (merge / keep mine / keep remote) is unchanged.

### 3. Auditable Conflict & Checkpoint Log
Replaces the earlier history playback with something you can act on:

- **Session checkpoints** — when a person starts editing, the board is snapshotted (START); when they go
  idle for a minute or leave, again (END). Every checkpoint shows who and when, can be viewed, and the
  board can be reverted to it by a majority vote.
- **Conflict log** (triangle icon, red counter = open conflicts) — every conflict with timestamp, who
  caused it and BEFORE / AFTER snapshots. The affected area gets a faint yellow outline on the board until
  someone marks it resolved; each person can *dismiss* the outline for themselves only.
- **"Drawn over" rule** — a new or moved object covering ≥ 30 % of someone else's object that was
  created or edited in the last 10 minutes is logged as an overlap conflict. Like rule 2 it is computed
  from shared state only, so every peer reaches the same verdict.
- Snapshots are stored inside the board's CRDT document and de-duplicated (images kept once by hash), so
  the log syncs and works offline like everything else.

---

## Monorepo Layout

```text
canvas-crdt/
├── apps/
│   ├── client/src/
│   │   ├── app/                 # identity (device id, name, pointer colour, joined rooms), signalling URL
│   │   ├── theme/               # day / night palettes, CSS variables, MUI theme
│   │   ├── features/
│   │   │   ├── board/           # BoardCanvas, toolbar, selection bar, geometry, renderer, logs
│   │   │   ├── room/            # useRoom (membership, approval, boards, votes), types
│   │   │   ├── panels/          # room details, profile, share, conflicts, checkpoints, comments, about
│   │   │   ├── crdt/            # connection, awareness, ops (undo/redo), conflict widget
│   │   │   ├── media/           # Watch Party (sync, screen share, dock)
│   │   │   ├── chat/            # room chat
│   │   │   ├── templates/       # 2 demo templates
│   │   │   ├── canvas/          # export PNG/PDF, image prep, migration recovery (+ tests)
│   │   │   └── demo/            # demo-scenarios explainer (minimisable)
│   │   ├── hooks/               # useCanvasCRDT (Yjs + WebRTC + IndexedDB per board)
│   │   └── views/               # JoinScreen, RoomScreen (waiting screens + Watch Party), BoardView
│   └── server/src/index.ts      # signalling relay, /api/ip, /api/time, media upload & streaming
├── packages/engine/src/         # CRDT engine: shapes, vector clocks, union-bbox, ambiguity, Yjs binding
├── docs/
└── tests/e2e/
```

---

## Getting Started

Prerequisites: Node.js ≥ 20.

```bash
git clone https://github.com/kevincell/canvas-crdt.git
cd canvas-crdt
npm install
npm run dev        # signalling :3001 + client :5173
```

Full step-by-step guide (addresses, test mode, who counts as a peer, online / offline): **[RUN_GUIDE.md](./RUN_GUIDE.md)**.
What changed in this version: **[UPDATES.md](./UPDATES.md)** (details) and **[CHANGES.md](./CHANGES.md)** (short list).

| Who | Address |
|---|---|
| This computer | `http://localhost:5173` |
| Other devices on the same Wi-Fi / hotspot | `http://<this computer's LAN IP>:5173` (shown in Share / Room details) |
| A second person in the same browser (testing) | `http://localhost:5173/?guest=1` |
| View only | Share → *View only* link (ends in `&view=1`) |

Windows Firewall must allow ports 5173 and 3001 for other devices. If the machine has several network adapters and Share shows the wrong address, start the signaler with `LAN_IP=<reachable-address> npm run dev:server` and use that address in the phone URL.

Use the **Edit** link for people who need to draw. The **View only** link intentionally disables all canvas writes.

Try it with two people:
1. A: open http://localhost:5173, enter a name, **Create room**.
2. Room details → copy the Room ID (or Share → *Edit* link, which uses the LAN address).
3. B (another device, another browser, or a `?guest=1` tab): enter a name, paste the ID, **Ask to join** → A presses **Allow**.
4. Draw on both at once, resize the same rectangle from both sides, go offline and back.

---

## Testing

```bash
npm test                     # engine + client unit tests
npm run typecheck            # engine, client, server
npx playwright test          # end-to-end
```

Client suites: `imageLimits.test.ts`, `readOnlyGuard.test.ts`, `mediaSync.test.ts`.

---

## Removed in this version
Dual-peer split mode, sticky notes (now comments), history playback, brush textures, stencils,
facilitation (timer / dot voting / retros), task-tracker export, quick find, presentation mode,
alignment guides & tidy, duplicate board, Calibri, 1:1 / fit buttons. Demo scenarios are kept as a
minimisable explainer with the scripted demos switched off.

---

## License

MIT © 2026 CRDT Canvas Team
