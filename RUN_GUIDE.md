# Run guide

## Start
1. Install Node.js 20 or newer.
2. Open a terminal in the project folder: `cd C:\MajorProject\canvas-crdt`
3. First time only: `npm install`
4. Start everything: `npm run dev`
   - signalling server → port **3001**
   - app → port **5173**
5. Stop: press **Ctrl + C** in that terminal.

## Addresses
| Who | Open | Notes |
|---|---|---|
| This computer | `http://localhost:5173` | Use this on the host laptop (screen share needs localhost or https). |
| Other devices on the same Wi-Fi / hotspot | `http://<this computer's IP>:5173` (e.g. `http://192.168.1.41:5173`) | Find the IP with `ipconfig` (IPv4 address) or copy it from Share / Room details. |
| Second person on the same browser (testing) | `http://localhost:5173/?guest=1` | That tab becomes a separate person. |
| View-only | the **View only** link from Share (ends in `&view=1`) | Just the drawing, no tools, no approval. |

- Windows Firewall must allow ports **5173** and **3001** for other devices.
- All devices must be on the same network (no internet needed).

## Quick test with two people
1. Tab / device A: enter a name → **Create room**.
2. Copy the room ID (Room details) or the **Edit** link (Share).
3. Tab / device B (`?guest=1` tab, another browser, or another device): enter a name → paste the ID → **Ask to join**.
4. A: press **Allow** on the pop-up.
5. Draw on both at the same time; try resizing the same rectangle from both.

## Who counts as a person (peer)
- **Same browser, several tabs** → **one person**. Tabs share one device ID; counts and lists show them once.
- **Same browser, different name** (e.g. Ruby, then Ethan) → still **one person**; the name just updates.
- **Different browser on the same computer** (Chrome vs Edge), **incognito window**, or a **`?guest=1` tab**
  → a **different person** (they don't share storage).
- **Different device** → a different person.
- Behind the scenes every tab is still its own CRDT replica (needed for merging); that's invisible in the app.

## Online / offline
- **"N on this board"** → N people are connected to this board right now.
- **"Online · only you here"** → the signalling server is reachable but nobody else is on this board.
- **"Offline · saved locally"** → the signalling server can't be reached. You can keep working; everything is
  saved in this browser and merges automatically when you reconnect.
- In Room details: green dot = online now; otherwise "seen … ago".
- A person counts as **active** for votes if they were seen in the last **7 days**.

## Joining rules
- New people wait until any approved member presses **Allow**.
- If nobody from the room is online, they wait until someone is.
- People who were approved before go straight back in.
- Declined or removed people can ask again.

## Troubleshooting
- Stuck on "Waiting to join" → check a member is online and both are on the same network / server.
- "This browser is already in this room in another tab" → use another browser, incognito, or `?guest=1`.
- Other device can't open the page → use the IP address (not localhost) and check the firewall.
- `'pnpm' is not recognized` → use `npm run dev` (or install pnpm with `npm i -g pnpm`).
