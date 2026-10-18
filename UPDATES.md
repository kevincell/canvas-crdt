# Updates — Watch Party (Media Sync) for canvas-crdt

This file summarises everything in this local copy that is **not yet on GitHub**
(`kevincell/canvas-crdt`, last pushed commit `ba96be1` — "Fixed text overlap issue", 2 Oct 2026).

Local commits not yet pushed:

| Commit | Description |
|---|---|
| `4da88ab` | BACKUP: first Watch Party version (YouTube sync, wide/full-screen overlay with auto-hide) |
| `f8c349b` | Offline file streaming, screen/relay share, captions & speed, peer skip, precise sync, YouTube-to-file switch fix |

The canvas itself (drawing, shapes, CRDT engine, conflict handling) is **unchanged**. All changes are in the
Watch Party feature, participant tracking, and the Node server.

---

## 1. What's new for users

### Watch Party dock (new feature — not on GitHub at all yet)
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

### Sync accuracy (how peers stay together)
- **Shared clock** — every device measures its offset to the server clock (`/api/time`, best of 5 round trips,
  refreshed every 30 s), so laptops with wrong clocks on an offline hotspot still agree on time.
- **Host heartbeat** — the host re-publishes its *real* player position whenever it drifts > 0.4–0.5 s
  (e.g. after buffering), so peers never follow a stale time.
- **Listeners follow the host's exact video ID** and have **no YouTube playlist/Mix of their own**, so they can
  never wander off to a song the host didn't play.
- **Smooth correction** — small drift is fixed by nudging playback speed ±8 % (inaudible); bigger drift by a seek
  that leads slightly ahead to cover buffering, then verifies and self-tunes the lead per device.
- Measured result on a test laptop: peers settle at about **±0.05 s** from the host.

---

## 2. Files changed vs GitHub

| File | Status | Summary |
|---|---|---|
| `apps/client/src/features/media/MediaSyncDock.tsx` | **new** | The whole Watch Party UI: YouTube + HTML5 players, host/listener controls, upload, subtitles, screen share & relay view, captions/speed menus, shortcuts, sync engine (lead-learning seeks, speed nudging, heartbeat), drift readout. |
| `apps/client/src/features/media/useMediaSync.ts` | **new** | Broadcast state in the Yjs map `media-broadcasts`: start/stop/tune-in, play/pause/seek all, loop, autoplay, track changes, playback rate, subtitles, host heartbeat (`reanchor`), orphaned-host cleanup, clock sync. |
| `apps/client/src/features/media/useScreenShare.ts` | **new** | WebRTC screen/tab + audio sharing. Signalling over the Yjs map `screen-share-signals` (works offline). Non-trickle ICE, one connection per viewer, stereo high-bitrate Opus for music, video bitrate cap, stale-sharer detection, "relay this tab" with Region Capture cropping. |
| `apps/client/src/features/media/types.ts` | **new** | `PeerBroadcast` type, YouTube URL parsing, `calculateEffectiveTime`, shared clock (`serverNow`, `syncClockWithServer`), media-server URL resolution, SRT→VTT converter, speed list. |
| `apps/client/src/features/media/index.ts` | **new** | Barrel exports. |
| `apps/client/src/features/media/__tests__/mediaSync.test.ts` | **new** | Vitest: URL parsing, effective-time maths, two-peer Yjs convergence for play/pause/seek and playlist changes, no interference with canvas shapes. |
| `apps/client/src/views/SingleCanvasView.tsx` | modified | Adds the Watch Party top-bar button + live indicator, mounts the dock, wires media sync + screen share, auto-opens the dock when someone shares their screen. "Leave Room" became **Exit Board** with a confirmation prompt. |
| `apps/client/src/features/crdt/model/useCRDTAwareness.ts` | modified | Participants are rebuilt from the full awareness state on every update and **de-duplicated by name** (keeps the newest connection), and built immediately on mount. |
| `apps/client/src/hooks/useCanvasCRDT.ts` | modified | `peerCount` now comes from the de-duplicated participant list instead of the raw WebRTC peer count. |
| `apps/server/src/index.ts` | modified | New endpoints (below). Fixed ESM `__dirname` crash. CORS updated for uploads/Range. |
| `.gitignore` | modified | Ignores `apps/server/uploads/`. |

> Tip: `git diff --stat origin/main` shows much bigger numbers for `SingleCanvasView.tsx`, `index.ts` and
> `.gitignore` because Windows changed their line endings (LF→CRLF). Use
> `git diff --stat --ignore-cr-at-eol origin/main` to see only the real changes.

---

## 3. Server API additions (`apps/server/src/index.ts`, port 3001)

| Method & path | Purpose |
|---|---|
| `POST /api/media/upload` | Upload raw file bytes (header `X-Filename`, URI-encoded). Streams to disk, 500 MB max, only audio/video/`.vtt` types allowed. Returns `{ id, path, url, filename, size }`. |
| `GET` / `HEAD /api/media/:id` | Streams an uploaded file with full HTTP Range support (`bytes=a-b`, `a-`, `-n`) for seeking; 416 on bad ranges; path-traversal safe. |
| `GET /api/time` | Server clock `{ now }` for watch-party clock sync. |

- Uploads are saved in `apps/server/uploads/` (git-ignored) and deleted automatically after **6 hours without
  anyone streaming them** (checked every 15 min and at start-up).
- The broadcast stores a relative path (`/api/media/<id>`); each peer resolves it against its own route to the
  server, so it works for the host (localhost) and for hotspot peers (LAN IP) alike.

---

## 4. Bugs fixed along the way
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

## 5. How to run

```cmd
cd canvas-crdt
npm run dev
```

- Host laptop: open **http://localhost:5173** (screen share / relay only work on localhost or https).
- Other devices on the same Wi-Fi / hotspot: open **http://&lt;host-LAN-IP&gt;:5173**.
- Windows Firewall must allow ports **5173** and **3001**.
- Screen share / relay: in Chrome's picker tick **"Share tab audio"** (or "Share system audio").
- Some MKV files (HEVC video / DTS audio) won't play in browsers — re-encode to MP4 if needed.
