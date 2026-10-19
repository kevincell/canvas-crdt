# Sprint 15: Integrations and Extensibility Discovery

## Executive Summary

This discovery record documents the architectural evaluation, threat model, and extension boundaries for external integrations in CRDT Canvas. It directly supports **Sprint 15** of the agile product roadmap.

The core differentiator of CRDT Canvas is **transparent, offline-first, peer-to-peer collaboration without account lock-in**. Any external integration must preserve this contract:
1. **Engine Decoupling:** The canvas engine (`@crdt-canvas/engine`) and Yjs document structures must remain pure data models free from SaaS vendor APIs (Jira, Linear, GitHub, Slack, Notion).
2. **Explicit Consent & Data Boundaries:** No board data is transmitted to third parties without active user action and a visible review of the payload. Cryptographic peer tokens, vector clocks, and pre-migration history stores never leave the client.
3. **Graceful Offline Fallback:** If internet access is lost, handoffs export to local portable formats (Markdown checklists, CSV files, JSON recovery snapshots) rather than failing silently.

---

## 1. Discovery on Import / Export Formats

| Format | User Value | Technical Complexity | Fidelity / Risk | Decision |
|---|---|---|---|---|
| **JSON Snapshot (`crdt-canvas-board`)** | Full board recovery, template distribution, backup/restore. | Low: Native serialization of Yjs shapes. | High fidelity: Validated schema versions, safe ID remapping. | **Adopted as primary standard**. |
| **PDF & PNG Board / Selection Export** | Sharing visual boards with external stakeholders and reports. | Medium: Canvas rendering pass, off-screen canvas culling. | High fidelity: Vector text and geometry preserved in PDF. | **Adopted in Sprint 12**. |
| **GitHub Issues Markdown** | Handoff from brainstorm/retrospective sticky notes into issue trackers. | Low: Structured transformation of notes, frame titles, and checklists. | Text fidelity: Checkboxes, categories, labels. | **Prototyped in Sprint 15**. |
| **CSV (Jira / Linear / Spreadsheet)** | Bulk import of user stories and action items into project trackers. | Low: Comma-separated summary, description, status, and frame category. | Universal compatibility across enterprise PM tools. | **Prototyped in Sprint 15**. |
| **SVG Export** | Editable vector graphic export for designers. | High: Converting complex composite canvas operations to SVG DOM nodes. | Medium risk of style drift across SVG renderers. | **Deferred to backlog**. |

---

## 2. Discovery on Task Tracker Handoff

### Problem Statement
Teams frequently use CRDT Canvas for sprint planning, brainstorms, and agile retrospectives. Once ideas converge on sticky notes, users manually copy-paste cards into GitHub Issues, Jira, or Linear.

### Evaluated Approaches
1. **Deep OAuth Vendor Integration (Jira/Linear APIs):**
   - *Drawback:* Requires hosting backend OAuth secrets, managing user credentials, handling rate limits, and violating zero-knowledge local-first principles.
   - *Verdict:* Rejected as disproportionately heavy for early product stages.
2. **Consent-Bounded Webhook & Formatted Clipboard Export:**
   - *Benefit:* Client-side only. User chooses the scope (selected notes, specific frame column like "Action Items", or all notes), views the exact JSON/Markdown payload, and can either copy with 1 click, download a `.md`/`.csv` file, or dispatch to a custom webhook URL with explicit confirmation.
   - *Verdict:* **Adopted and implemented (`TaskTrackerHandoffModal.tsx`)**.

### Data Boundary Policy
Every task handoff payload is structurally sanitized:
- **Included:** Extracted text, note title, description, parent frame title, and badge colors.
- **Excluded:** Deleted objects, undo/redo stacks, participant cursor history, room encryption keys, and raw Yjs binary updates.

---

## 3. Discovery on Presentation Workflows

### Evaluated Approaches
1. **Live Frame Navigation (In-App Presenter Mode):**
   - *Implementation:* Users create named frames (`ShapeKind.Rect` with `frameTitle`). In Presenter Mode, arrow keys navigate frame-by-frame, zooming the viewport to fit each frame.
   - *Verdict:* Implemented in Sprint 5/12; fast, zero latency, and syncs across peers.
2. **Read-Only Token Sharing:**
   - *Threat Model:* A guest link with `?token=...` allows viewing without write permission.
   - *Architecture:* WebRTC signaling can enforce read-only data channels by rejecting incoming Yjs updates from unauthorized peers.

---

## 4. Extension Points Architecture

To prevent provider lock-in, CRDT Canvas exposes three clean client-side extension points:

```
┌────────────────────────────────────────────────────────┐
│                   CRDT Canvas Client                   │
├────────────────────┬───────────────────────────────────┤
│ Board Exporters    │ interface BoardExporter {         │
│                    │   id: string;                     │
│                    │   export(shapes, meta): Promise;  │
│                    │ }                                 │
├────────────────────┼───────────────────────────────────┤
│ Template Providers │ interface TemplateProvider {      │
│                    │   list(): CuratedTemplate[];      │
│                    │   instantiate(id): Shape[];       │
│                    │ }                                 │
├────────────────────┼───────────────────────────────────┤
│ Webhook Dispatcher │ interface HandoffDispatcher {     │
│                    │   dispatch(url, payload): Result; │
│                    │ }                                 │
└────────────────────┴───────────────────────────────────┘
```

---

## 5. Decision Log

1. **DEC-15-01: No Backend SaaS Credential Storage**
   - We will not store third-party API tokens (Jira/GitHub) on signaling servers. Task handoffs remain local-first with clipboard, file downloads, and direct webhook POST requests.
2. **DEC-15-02: Universal Markdown & CSV Interoperability**
   - GitHub Markdown checklists and standard CSV imports serve >90% of team handoff needs without requiring custom vendor SDKs.
3. **DEC-15-03: Measured Rollout**
   - Monitor usage of the Task Tracker Handoff tool before evaluating deeper third-party plugin systems.
