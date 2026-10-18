# Changes since the last pushed UPDATES.md

The previous UPDATES.md described the **Watch Party** work only. This update adds a full rebuild of the board
and a rooms system. Details are in UPDATES.md (Part A); how to run is in RUN_GUIDE.md.

## Added
- Rooms: create / join / your rooms list; each room has a host, members and its own chat.
- Join approval: Allow / Decline by any approved member (works when the host is offline).
- Multiple boards per room; a new room starts with one empty board; New board never overwrites.
- Room details panel: room ID & name, people with pointer-colour dots, boards, votes, kick, leave, delete.
- "You" menu: name, pointer & laser colour, rooms joined (click to switch), day / night.
- Share: view-only link and edit link.
- Names and descriptions for rooms and boards.
- New canvas with tools: select (cursor), hand box-select & group move, pen, line / arrow, rectangle, ellipse,
  text box, image, fill, partial eraser (S / M / L), delete, laser with glow and tail.
- Selection bar: colour, fill, thickness, dash styles, corners, opacity, font, − / + resize, comment, lock, delete.
- Fonts: Arial and Times New Roman.
- Locks + voting: delete board / room ≥ ¼; unlock, delete locked, revert > ½.
- Checkpoints: START / END per edit session with pictures and revert-by-vote (replaces history playback).
- Conflict log: triangle icon with red counter, timestamp, who caused it, before / after pictures,
  yellow outline until resolved, per-person dismiss, new "drawn over" rule.
- Comments attached to selected objects.
- About panel (every icon explained).
- Day / night theme per device.
- Watch Party keeps playing across boards of the same room; stops when you leave the room;
  minimised pill always on top.
- Online status: "only you here" vs "offline".
- One browser = one person (tabs merged); `?guest=1` test mode for a second person in one browser.

## Removed
- Dual-peer split-screen mode
- Sticky notes (replaced by comments; old notes still display)
- History playback / time-travel scrubber, merge lens
- Brush textures (one line style)
- Stencils, facilitation (timer, dot voting, retros), task-tracker export
- Duplicate board, quick find, presentation mode, alignment guides / tidy / snap
- Old share modal, old checkpoints, old comments
- Calibri font
- 1:1 and fit zoom buttons (only + / − now)
- 2 of the 4 templates
- Scripted demo actions (panel kept as an explainer)

## Unchanged
- CRDT engine: union-bounding-box merge, intent-ambiguity detection, conflict resolution buttons.
- Watch Party playback and sync engine.
- Signalling server and its APIs.
- Peer-to-peer sync and offline storage.
