# Verification scope

Release 0.2.0 was checked on macOS with Node.js 22.23.1 and Obsidian 1.15.1 using an isolated copy of the generic example vault.

## Automated

- TypeScript checks for the hub, shared packages and web editor.
- 69 tests across 15 files: inherited canvas operations, formatting and unknown-field preservation; HTTP/MCP integration; layout mapping; multi-selection references; file watching; revision conflicts; concurrent writers; path containment; Markdown excerpts.
- `npm run test:package` extracts the release ZIP into a temporary directory and launches its bundled MCP server over stdio. It checks explicit vault selection, bundled browser assets, selected-card references, targeted edits, rejected stale writes and linked-note updates.
- CI runs the same commands on Linux. A local pass does not imply that a remote workflow has completed.

## Observed in the desktop browser and Obsidian

- Nested groups and cards retained their coordinates and dimensions.
- Shift-click selected multiple cards; right-click retained the selection and produced a reference containing both card IDs.
- A copied reference continued to identify its original selection after the browser selection changed.
- Text edited in the browser appeared in the open Obsidian Canvas; text edited in that Obsidian Canvas appeared back in the browser. Neither operation changed card geometry.
- External linked Markdown edits refreshed the file card.
- A stale browser draft was rejected after another writer saved the same board. The newer file survived and the browser displayed the rejected draft for recovery.
- Dragging the outer group moved all nested descendants together.
- The 640 px browser preview could collapse its file list without horizontal page overflow; the default 1280 px layout showed the full sidebar and multi-card context menu.

## Boundaries

The stdio package test is a real MCP client test, not a claim that the plugin was installed into every ChatGPT/Codex client. Native chat attachment insertion and public directory installation are not implemented. Shift-drag selection uses the underlying React Flow interaction; automated desktop verification covered Shift-click, not a reliable held-key drag. See [compatibility](compatibility.md) for saved-file synchronization and rendering limitations.
