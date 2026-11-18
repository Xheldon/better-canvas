# Verification

Use Node.js 22.18 or newer.

Required checks:
1. npm run typecheck
2. npm test
3. npm run build
4. npm run plugin:pack
5. npm run test:package

Automated coverage includes:
- JSON round-trip formatting and unknown-property preservation.
- Transactional AI operations, invalid geometry, immutable IDs and missing endpoints.
- HTTP mutation route rejection and file bytes remaining unchanged.
- MCP revisions, stale updates, competing writers, history and stable references.
- Filesystem notifications, linked-note excerpts, vault boundary checks and multiple preview sessions.
- Zoom geometry, edge anchors, composer references, acknowledgment/failure handling, duplicate submission and IME/Shift+Enter behavior.
- Extracted release ZIP, real stdio MCP client, bundled UI resource and model-only write-tool metadata.
- Real MCP Apps SDK handshake and message acknowledgment through a simulated protocol host; host visibility policy is configured explicitly.
- Host file-entrypoint resolution, missing metadata, non-Canvas inputs and out-of-vault rejection.
- React pointer/wheel interaction tests: Shift-drag from card text or background, live composer chips, additive selection, click toggling, cancellation/Escape, Cmd/Ctrl wheel anchoring and line-delta normalization, and selection after zoom/pan. These run in jsdom with layout/pointer-capture shims, not in the native desktop panel.

For manual UI checks use a disposable copy of examples/vault. Verify selection chips, Shift selection, background pan, card drag having no effect, editing shortcuts having no effect, linked notes, narrow layout, and refresh after an MCP edit. Compare the file bytes before and after read-only gestures.

Composer unit tests use a simulated host. Package tests use a real MCP client but do not establish that a particular desktop application's panel loads or that ui/message reaches that application's current conversation. Record that host acceptance separately; do not label a localhost preview as connected.

Manual checks on 2026-11-17: desktop and narrow browser layouts, Shift selection, reference chips, card drag and Backspace leaving geometry unchanged, linked-note previews, and a targeted MCP edit updating the visible card in place. Focusing cards must leave the viewport element scrollTop/scrollLeft at zero; panning uses only the scene transform. At this stage desktop-host message delivery was unverified; the ordinary browser correctly kept Send disabled.

Manual checks on 2026-11-18 used a disposable two-card Canvas in a private vault. Selecting a card in the live browser produced the same ID through MCP. A stable reference was resolved, then a real stdio MCP edit changed only that card's text. All geometry, the other card and the edge were identical. The already-open Obsidian Canvas and browser updated without a reload. Obsidian's official CLI independently read the updated file. In the disconnected browser, pressing Enter preserved the draft and made no edit. This verifies the reference/write/synchronization portion, **not** message delivery to the current chat.

The initial native desktop attempt returned data without an inspectable panel. Version 0.3.1 adds the documented fullscreen preference, compatibility metadata and file-viewer entrypoint. Those declarations and resource bundles pass package tests.

The local configuration had `enable_mcp_apps=false`. It was enabled using the documented CLI command. After the host reloaded, native panel sessions began making MCP calls. The earlier missing-panel observation must not be attributed conclusively to the upstream issue.

## Native desktop acceptance, 2026-11-18

Environment: ChatGPT desktop 26.1111.21308 (build 27194), Node.js 22.23.1, Obsidian 1.15.1, macOS, plugin 0.3.1.

- A human submitted a real selected-card request through the native panel. The existing conversation received the instruction and immutable reference ID as an MCP App message.
- AI resolved the reference, read the current board and applied one revision-checked text update. Comparison of the full before/after data confirmed that only the referenced card text changed; geometry, other cards, connections and order were preserved.
- The official Obsidian CLI queried the already-open Canvas view's data, which contained the updated card text without reopening the file.
- The live panel session reported the same new revision through its selection heartbeat, establishing that it had fetched the updated snapshot.

This is a real submission/write/synchronization acceptance, not a simulated chat delivery. The final pointer/keyboard action used to submit was not independently observed: Enter, Shift+Enter, IME and gesture behavior have automated event tests. The panel refresh check used its reported revision rather than a new screenshot. Other clients, platform combinations and native file-entrypoint opening remain unverified. Private board names, content, paths and reference IDs are deliberately omitted here.
