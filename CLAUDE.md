# Better Canvas contributor notes

Public source, docs, fixtures and screenshots must be generic. Never commit user vaults, local evaluations, credentials or unrelated project content.

## Architecture

- packages/core: JSON Canvas types, formatting and explicit transactional operations.
- packages/hub: revision-safe file storage, read-only loopback preview and stdio MCP.
- packages/web: React HTML/SVG read-only renderer, selection and bottom composer.
- The same React source builds both the localhost preview and a self-contained MCP App resource.

## Invariants

1. Preview gestures never edit content. No content-writing HTTP endpoints, clipboard writes to cards, card movement, resize, deletion or creation.
2. File modifications go through AI/MCP. Require the freshly read revision; preserve unrelated properties and coordinates.
3. No auto-layout. No agent spawning. No extra chat sidebar. No copy-reference modal.
4. Only an acknowledged MCP Apps ui/message call counts as a sent request. Plain browser mode cannot send. Preserve drafts on error, and do not confuse sent with applied.
5. User-chosen vault only. Keep recovery history and view metadata in .better-canvas. Obsidian unsaved state does not share our locks.
6. Respect JSON Canvas node order, geometry, groups and edge endpoints. Document rendering limitations rather than claiming pixel identity.
7. Keep MIT attribution for the retained parsing/serialization code. Do not reintroduce canvai as the framework.

Run npm run typecheck, npm test, npm run build, npm run plugin:pack and npm run test:package before release. Use disposable generic vaults for mutation tests. UI tests must distinguish a simulated host from an actual desktop host.
