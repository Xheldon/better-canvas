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

Manual checks on 2026-11-17: desktop and narrow browser layouts, Shift selection, reference chips, card drag and Backspace leaving geometry unchanged, linked-note previews, and a targeted MCP edit updating the visible card in place. Focusing cards must leave the viewport element scrollTop/scrollLeft at zero; panning uses only the scene transform. Actual desktop-host message delivery remains unverified; the ordinary browser correctly keeps Send disabled.

Manual checks on 2026-11-18 used a disposable two-card Canvas in a private vault. Selecting a card in the live browser produced the same ID through MCP. A stable reference was resolved, then a real stdio MCP edit changed only that card's text. All geometry, the other card and the edge were identical. The already-open Obsidian Canvas and browser updated without a reload. Obsidian's official CLI independently read the updated file. In the disconnected browser, pressing Enter preserved the draft and made no edit. This verifies the reference/write/synchronization portion, **not** message delivery to the current chat.

The native desktop panel did not mount through the available nested tool-call channel. Version 0.3.1 adds the documented fullscreen preference, compatibility metadata and file-viewer entrypoint. Those declarations and resource bundles pass package tests; actual native opening and Enter-to-current-chat delivery remain required acceptance steps after the host reloads the plugin. Do not publish this as a completed end-to-end workflow until both are observed.

The tested local configuration also had `enable_mcp_apps=false`. It was enabled using the documented CLI command. Host restart/reconnection and the ensuing native-panel acceptance are pending; the earlier observation alone must not be attributed conclusively to the upstream issue.
