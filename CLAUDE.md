# Better Canvas contributor notes

Better Canvas extends canvai as a local Obsidian Canvas editor and desktop ChatGPT/Codex plugin. Keep upstream attribution and MIT licensing. Public docs, comments and examples use English and generic content only. Never commit user vaults, credentials, local test output or unrelated private projects.

## Architecture

- `packages/canvas-kit`: JSON Canvas parsing, semantic operations and optional layout.
- `packages/hub`: revision-checked file storage, HTTP/WebSocket preview and MCP tools.
- `packages/web`: React Flow editor and selection references.
- `plugin.json`, `mcp.json`, `skills/`: desktop plugin packaging.

## Invariants

1. Preserve unknown JSON fields, existing IDs, coordinates, dimensions and file formatting. Opening a board never runs automatic layout.
2. Require a fresh revision for card and note edits. Reject stale writes and preserve recoverable drafts/history. Obsidian does not share our file lock; do not claim cross-application atomic transactions.
3. Keep conversation in the host chat. Do not reintroduce a separate chat sidebar or automatically spawn another AI.
4. Native browser annotations are host-controlled. Expose stable DOM IDs and MCP references, without claiming direct insertion into the host chat input.
5. The user explicitly chooses a vault. Keep file operations inside it and exclude `.local`, vault metadata and private data from release packages.
6. Only rearrange a board when requested. Keep previews structurally compatible, without promising theme- or plugin-identical rendering.

`docs/compatibility.md` describes the current contract. Other upstream architecture/deployment notes are historical background, not the fork's current requirements.

## Verification

Node.js >=22.18. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run plugin:pack`, and `npm run test:package` before release. Use a copy of `examples/vault` for manual checks. Do not install or reconfigure a user's MCP clients merely to work around a test harness failure.
