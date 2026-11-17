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

For manual UI checks use a disposable copy of examples/vault. Verify selection chips, Shift selection, background pan, card drag having no effect, editing shortcuts having no effect, linked notes, narrow layout, and refresh after an MCP edit. Compare the file bytes before and after read-only gestures.

Composer unit tests use a simulated host. Package tests use a real MCP client but do not establish that a particular desktop application's panel loads or that ui/message reaches that application's current conversation. Record that host acceptance separately; do not label a localhost preview as connected.

Manual checks on 2026-11-17: desktop and narrow browser layouts, Shift selection, reference chips, card drag and Backspace leaving geometry unchanged, linked-note previews, and a targeted MCP edit updating the visible card in place. Actual desktop-host message delivery remains unverified; the ordinary browser correctly keeps Send disabled.
