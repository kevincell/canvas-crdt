# Updates — canvas-crdt

Everything in this version compared with the last state on GitHub (`kevincell/canvas-crdt`).
Two big pieces of work:

1. **Watch Party** — synced music / video / screen sharing (already described in the previous UPDATES.md, kept
   below in Part B and updated).
2. **Board & rooms rebuild** (new in this update, Part A) — new canvas and tools, rooms with multiple boards,
   join approval, voting, locks, checkpoints, conflict log, comments, day / night theme, and a lot of
   features removed to keep the app focused.

The CRDT engine (`packages/engine`) — union-bounding-box merge, intent-ambiguity detection and conflict
resolution — is **unchanged**. Shapes keep the same format, so old boards still open.

For a short list of what was added / removed see **CHANGES.md**. For how to run it see **RUN_GUIDE.md**.

---

# Part A — Board & rooms rebuild (new)

## A1. Rooms, boards and people

### Rooms
- **Home screen**: your name, pointer & laser colour, **Create a room** (name + description),
  **Join a room** (room ID or a pasted link), and **Your rooms** (rooms you created or joined before).
- A room has its own shared Yjs document `<roomId>::room` holding: room info, members, declined requests,
  the list of boards, votes, room chat and the Watch Party channels.
- Creating a room makes you the **host** and creates **one empty board** ("Board 1").
- The address bar always shows `?room=<id>&board=<id>`, so refreshing or copying the URL reopens the same board.

### Join approval (basic — not a security feature)
- Someone joining sees **"Waiting to join"** until an approved member presses **Allow** or **Decline**.
- **Any approved member** can answer, not only the host — so it works when the host is offline.
- Requests appear as a pop-up card on the board and in Room details (with a red counter on its icon).
- The waiting screen tells the joiner what is happening: how many members are online, "no member online yet",
  "can't reach the signalling server", or "this browser is already in the room in another tab".
- Declined → *Ask again*. Removed (kicked) → *Ask to rejoin*. Both need approval again.
- People who were already approved go straight back in.

### People / identity
- **One browser = one person.** Each browser gets a permanent device ID (stored locally). Your name is just a
  label: renaming yourself on the same browser updates your member entry instead of creating a new person.
- Several tabs of the same browser count as **one** person (one entry in counts and lists, your own other tabs
  don't show as extra cursors).
- Different browsers, incognito windows or other devices are different people.
- **Test mode:** opening a tab with `?guest=1` gives that tab its own separate identity, so you can test as a
  second person in the same browser.

### Room details panel (top right)
- Room name, description (editable by the host), **room ID** with copy button, host name, connection info.
- **People**: everyone with their **pointer-colour dot**, online / last-seen, who approved them, host badge.
  Viewers (view-only link) and removed people are listed separately.
- **Host**: kick a member (their drawings stay), start a **Delete room** vote.
- **Everyone**: **Leave room** (if the host leaves, the host role passes to the longest-standing member).
- **Boards**: list with name, description, creator; open, rename (creator), delete (creator → vote);
  **New board** creates another empty board without touching the others.
- **Votes**: open votes with progress bars and an *Agree* button; recent results.

### "You" menu (avatar, top right)
- Change your name, pointer & laser colour, switch day / night.
- **Rooms you've joined** — click one to switch rooms. Home button.

### Sharing
- **Share** gives two links (using the LAN address so other devices can open them):
  - **View only** (`&view=1`): just the live drawing — no toolbar, no editing, no approval needed.
  - **Edit**: full tools; the person waits for approval.

### Multiple boards
- Board switcher next to the room name (dropdown) + **New board** dialog (name & description).
- Each board is its own Yjs document `<roomId>::b::<boardId>` stored in IndexedDB.
- Boards made before rooms existed are adopted automatically as the room's first board.

## A2. Canvas and tools

New canvas (`features/board/BoardCanvas.tsx`) replaces the old renderer/controller — fixes the select-tool
glitch, draws everything with one renderer (`render.ts`) that is also used for exports and previews.

| Tool | Key | Behaviour |
|---|---|---|
| Select (cursor) | V | Click to select one object, drag to move, round handles to resize, Shift-click to add. Drag empty space to pan. |
| Hand (box select) | H | Drag a translucent blue box (like Windows) → selects everything it touches. Drag inside the box to move the whole group, drag its corners to resize the group. |
| Pen | P | Freehand, smoothed, one line style (brush textures removed). |
| Line / arrow | L | Straight line: no arrow, arrow at end, or both ends. Ends attach to shapes and follow them. |
| Rectangle | R | Shift = square. Pointed or rounded corners. |
| Ellipse | O | Shift = circle. |
| Text box | T | Click or drag a box and type. Fonts: **Arial** and **Times New Roman**. Double-click to edit. |
| Image | I | Click to place, or drop / paste an image. |
| Fill | F | Fills a closed shape: rectangle, ellipse, text box, or a pen shape whose ends meet. |
| Eraser | E | **Partial** erase of pen strokes, like a pencil eraser — sizes **S / M / L**. |
| Delete | D | Deletes a whole object. |
| Laser | K | Glowing tip with a fading tail in your pointer colour; others see it live; nothing is saved. |

- **Tool options strip** next to the toolbar: colour (8 calm colours + custom), thickness, line style,
  opacity, arrow type, font & size, eraser size.
- **Line styles**: solid, dashed, dots with small gaps, dots with long gaps.
- **Selection bar** (floats above the selection, like Word's mini toolbar): colour, fill / no fill,
  thickness, line style, corners, opacity, font & size, **− / +** resize, comment, lock / unlock, delete.
  With the hand tool and an empty or full box: **Text box** turns the box into a text box of the same size.
- **Zoom**: mouse wheel, pinch, or the **+ / −** buttons bottom-right (1:1 and fit buttons removed).
- Pan: Space + drag, right / middle drag, or drag empty space with the cursor tool.
- Shortcuts: Ctrl+Z / Ctrl+Y, Delete, Ctrl+A, Esc.
- Drags are previewed instantly and written to the shared document in small batches.
- Dark ink is shown light on the night canvas (and very light ink dark by day) so drawings stay visible for
  peers using the other theme.

## A3. Locks and votes (room governance)

| Action | Who asks | Passes when |
|---|---|---|
| Delete a board | its creator | ≥ ¼ of active members agree |
| Delete the room | host | ≥ ¼ of active members agree |
| Unlock objects | anyone | > ½ of active members agree |
| Delete locked objects | anyone | > ½ of active members agree |
| Revert a board to a checkpoint | anyone | > ½ of active members agree |

- **Lock** from the selection bar: locked objects can't be moved, resized, restyled or erased and show a 🔒 badge.
- The person asking automatically votes yes. Asking the same thing again just adds your vote.
- **Active members** = approved, not removed, seen in the last 7 days. Votes expire after 24 hours.
- Every peer evaluates the same shared vote record, so the result is the same everywhere.
- Unanswered votes pop up as small cards (Agree / Later) and are listed in Room details.
- This governance layer sits on top of the CRDT — the conflict detection itself needs no voting.

## A4. Checkpoints (replaces history playback)
- When someone **starts editing**, the board is snapshotted (**START** checkpoint); when they stop for a minute
  or leave the board, again (**END**). Auto-merges and reverts also create checkpoints.
- Board-wide log with **name and time**; click one to see a **picture of the board** at that moment (enlargeable).
- **Revert to here…** starts a > ½ vote; when it passes the board is restored in one step and a "Reverted"
  checkpoint is logged.
- Snapshots live inside the board document (synced, offline); images inside snapshots are stored once.

## A5. Conflict log
- New **Conflicts** panel (triangle icon) with a **red counter** of open conflicts.
- Every entry: timestamp, type, **who caused it**, description, **BEFORE and AFTER snapshots** of the area.
- Open conflicts get a **very transparent yellow outline** on the board until someone marks them **resolved**.
- **Dismiss** hides the outline only for you (stored on your device); the counter stays until resolved.
- Logged automatically:
  - the engine's conflicts (edited at the same time, deleted while edited, …) — resolving them with the
    floating Merge / Keep mine / Remote widget is unchanged and also marks the log entry resolved;
  - union-bounding-box auto-merges (logged as already resolved, plus a merge checkpoint);
  - **"Drawn over" rule (new)**: a new or moved object covering ≥ 30 % of someone else's object that was made or
    edited in the last 10 minutes. Computed from shared state only, so every peer reaches the same result.

## A6. Comments and chat
- **Comments** replace sticky notes: select objects → comment. A 💬 pin with a count sits on commented objects;
  the panel shows comments on the selection and all others, with "show on board".
- Old sticky notes still display (as filled text boxes) so nothing is lost.
- **Chat** stays for general talk and is now **room-wide** (same chat on every board of the room).

## A7. Other panels
- **Templates**: 2 demo layouts (Brainstorm, Simple flowchart) — added next to existing content.
- **Export**: PNG or PDF of the whole board or the selection.
- **About**: every icon with its name and a one-line meaning, plus shortcuts.
- **Demo scenarios**: kept as a minimisable explainer; the scripted demos are switched off.

## A8. Day / night theme
- Per device (stored locally), toggle in the top bar, the You menu or the home screen.
- **Day**: pastel café-and-garden palette — sage greens, latte browns, cream canvas.
- **Night**: dark moss / bark tones, soft warm text — easy on the eyes but clearly readable.
- Applied everywhere: home and waiting screens, header, toolbar, panels, dialogs, Watch Party dock, conflict widget.

## A9. Watch Party changes in this update
- The dock now belongs to the **room**: it keeps playing when you switch boards in the same room.
- Going home or switching to another room stops anything you were hosting — nothing carries over to another room.
- The minimised pill now always stays on top of panels so it can be dragged anywhere.
- Restyled for day / night. Playback and sync behaviour are unchanged (Part B).

## A10. Connection status
- Top bar chip: **"N on this board"**, **"Online · only you here"** (signalling server reachable, nobody else yet),
  or **"Offline · saved locally"** (server unreachable — edits are kept and merge when you reconnect).

## A11. Removed
Dual-peer split-screen mode · sticky notes (→ comments) · history playback / time-travel scrubber · merge lens ·
brush textures · stencils · facilitation (timer, dot voting, retros) · task-tracker export · old share modal ·
duplicate board · quick find · presentation mode · alignment guides / tidy / snapping · old checkpoints & comments ·
Calibri font · 1:1 and fit zoom buttons · old templates (4 → 2) · old status panel / connection banner / presence menu.

## A12. Files

| Area | Files |
|---|---|
| New — app shell | `App.tsx` (routing), `main.tsx` (theme provider), `index.css`, `theme/theme.tsx`, `app/identity.ts`, `app/signaling.ts` |
| New — views | `views/JoinScreen.tsx` (rewritten), `views/RoomScreen.tsx` (waiting / declined / removed screens, Watch Party host), `views/BoardView.tsx` |
| New — board | `features/board/BoardCanvas.tsx`, `BoardToolbar.tsx`, `SelectionBar.tsx`, `ui.tsx`, `model.ts`, `geometry.ts`, `render.ts`, `useBoardLogs.ts` |
| New — rooms | `features/room/useRoom.ts`, `features/room/roomTypes.ts` |
| New — panels | `features/panels/RoomPanel.tsx`, `ProfileMenu.tsx`, `ShareDialog.tsx`, `ConflictsPanel.tsx`, `CheckpointsPanel.tsx`, `CommentsPanel.tsx`, `AboutPanel.tsx`, `SidePanel.tsx`, `SnapshotPreview.tsx` |
| New — templates | `features/templates/boardTemplates.ts`, `TemplatesDialog.tsx` |
| Modified | `features/chat/ChatPanel.tsx` (themed, room-wide), `features/demo/DemoShowcaseBar.tsx` (explainer only), `features/canvas/exportBoard.ts` (new renderer), `features/crdt/model/useCRDTOps.ts` (batch create / update / delete), `features/crdt/model/useCRDTConnection.ts` (device ID in presence), `features/crdt/model/useCRDTAwareness.ts` (one entry per browser), `features/crdt/ui/FloatingConflictWidget.tsx` (themed), `features/media/MediaSyncDock.tsx` (themed, pill on top), `hooks/useCanvasCRDT.ts` |
| Deleted | `views/SingleCanvasView.tsx`, `features/canvas/{CanvasRenderer,CanvasController,Toolbar,boardDuplication,boardSnapshot}`, `features/demo/{DualPeerContainer,DemoTip}`, `features/crdt/{StatusPanel,PartitionSimulator}`, `features/crdt/ui/{TimeTravelScrubber,MergeLens,PresenceMenu,ConnectionBanner}`, `features/{stencils,facilitation,integrations,sharing,checkpoints,comments}/`, `features/templates/{TemplatesModal,curatedTemplates}`, `utils/audio.ts`, `features/canvas/__tests__/boardDuplication.test.ts` |
| Docs | `README.md` (rewritten), `UPDATES.md` (this file), `CHANGES.md`, `RUN_GUIDE.md` |

---

# Part B — Watch Party (from the previous update, still valid)

### Watch Party — features

#### Watch Party dock
A **🎬 Watch Party** button in the canvas top bar opens a floating media dock. One peer becomes the **host**
and everyone else in the room is a **listener** who plays the same thing in sync.

- **YouTube** — paste a video or playlist link and press *Broadcast*.
- **📁 Local files (works with no internet)** — pick an MP3 / MP4 / WebM / MKV / M4A / FLAC / WAV / OGG file.
  It uploads to the local server and every peer on the Wi-Fi / hotspot streams it from there.
  Upload progress bar, 500 MB limit, music files show an artwork card instead of a black screen.
- **💬 Subtitles** — host can attach a `.srt` or `.vtt` file to an uploaded video (`.srt` is converted automatically).
- **🖥️ Share Screen** — share any tab/window/screen **with audio** to all peers over WebRTC (peer-to-peer, LAN).
- **📡 Relay to peers** — host streams exactly what its YouTube player shows and plays (cropped to the player)
  so peers don't need YouTube or internet at all.
- **Host controls** — Play/Pause All, seek, ±10 s, previous/next track, loop, autoplay-next, speed for everyone.
- **Listener controls** — Pause (Me), personal volume, **⏪ / ⏩ 10 s just for me**, **Sync to Host**,
  personal speed override, captions on/off.
- **Live sync readout** for listeners — `Δ +0.05s` chip (green < 0.15 s, amber < 0.5 s, red above).
- **View modes** — floating dock, minimised draggable pill (audio keeps playing), wide/theater, native full screen
  with controls that auto-hide after 5 s.
- **Keyboard shortcuts** (only while hovering/clicked into the dock or in wide/full screen, never while typing):
  `Space` play/pause · `↑/↓` volume ±10 % · `←/→` skip ∓10 s (host: everyone, listener: just you) · `Esc` exit.
- **Multiple broadcasts** — if several peers broadcast, listeners can switch streams ("Tune In").

#### Sync accuracy (how peers stay together)
- **Shared clock** — every device measures its offset to the server clock (`/api/time`, best of 5 round trips,
  refreshed every 30 s), so laptops with wrong clocks on an offline hotspot still agree on time.
- **Host heartbeat** — the host re-publishes its *real* player position whenever it drifts > 0.4–0.5 s
  (e.g. after buffering), so peers never follow a stale time.
- **Listeners follow the host's exact video ID** and have **no YouTube playlist/Mix of their own**, so they can
  never wander off to a song the host didn't play.
- **Smooth correction** — small drift is fixed by nudging playback speed ±8 % (inaudible); bigger drift by a seek
  that leads slightly ahead to cover buffering, then verifies and self-tunes the lead per device.
- Measured result on a test laptop: peers settle at about **±0.05 s** from the host.

### Server API (`apps/server/src/index.ts`, port 3001)

| Method & path | Purpose |
|---|---|
| `POST /api/media/upload` | Upload raw file bytes (header `X-Filename`, URI-encoded). Streams to disk, 500 MB max, only audio/video/`.vtt` types allowed. Returns `{ id, path, url, filename, size }`. |
| `GET` / `HEAD /api/media/:id` | Streams an uploaded file with full HTTP Range support (`bytes=a-b`, `a-`, `-n`) for seeking; 416 on bad ranges; path-traversal safe. |
| `GET /api/time` | Server clock `{ now }` for watch-party clock sync. |

- Uploads are saved in `apps/server/uploads/` (git-ignored) and deleted automatically after **6 hours without
  anyone streaming them** (checked every 15 min and at start-up).
- The broadcast stores a relative path (`/api/media/<id>`); each peer resolves it against its own route to the
  server, so it works for the host (localhost) and for hotspot peers (LAN IP) alike.

### Watch Party bugs fixed
- Server crashed on start in ESM mode (`__dirname` is undefined) → uses `import.meta.url`.
- Upload buffered the whole file in RAM → now streamed to disk.
- Non-ASCII file names broke uploads → names are URI-encoded in the header.
- Toggling loop/autoplay mid-song snapped every peer back to an old position → time is re-anchored on every update.
- Peers played a different song than the host (personalised YouTube Mix indexes) → sync by video ID; listeners have no playlist.
- Host broadcast stopped tracking songs once YouTube left its queue → video ID is the source of truth.
- Black screen when switching from a YouTube broadcast to an uploaded file (React vs. YouTube iframe DOM clash) → YouTube now lives in its own non-React container.
- Screen share could fail to connect when ICE candidates arrived early → candidates bundled into the SDP (non-trickle).
- The YouTube **quality** selector was removed: YouTube ignores `setPlaybackQuality` for embeds (verified — it stayed at 480p whatever was requested).

---

## How to run
See **RUN_GUIDE.md**.

> Tip: `git diff --stat` may show huge numbers for some files because Windows changed their line endings
> (LF → CRLF). Use `git diff --stat --ignore-cr-at-eol` to see only the real changes.
