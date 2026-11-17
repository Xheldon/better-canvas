# Compatibility and synchronization

Better Canvas is a local browser editor and desktop ChatGPT/Codex plugin based on canvai. No Obsidian plugin is required. Both applications use the same `.canvas` files; no second content database is created.

## Layout

The renderer uses the file's `x`, `y`, `width`, `height`, node-array stacking order, groups (including geometric nesting), connection sides, labels, endpoint arrows, colors, and group background images. Opening a board does not run automatic layout or rewrite it. Negative coordinates are supported. Moving a group also persists its descendants' absolute positions.

This is structural/layout compatibility, **not pixel-identical rendering**. Obsidian's theme CSS, fonts, line wrapping, exact edge curves, viewport state, custom plugin shapes, and plugin-generated views are not copied. JSON Canvas deliberately leaves the exact six preset color values to the renderer. Unknown fields are preserved when editing but may not be rendered. Unsupported attachments show a placeholder rather than being removed.

Linked Markdown supports ATX heading excerpts and paragraph block IDs. Missing anchors show an error. Full Obsidian Markdown semantics, transclusion, Dataview and other plugin output are not implemented.

## Sync and conflict handling

- External saved `.canvas` edits trigger a browser refresh; linked notes and image files have separate change notifications.
- Browser and MCP changes write to the same original files.
- Card, connection and note updates supply the revision from its last read. Stale writes return a conflict instead of silently overwriting.
- Better Canvas writers use per-file locks and temporary files. Previous file contents are stored under `.better-canvas/history/<path hash>/<revision>.json` for manual recovery. Entries contain the original path and exact text. They remain local and are not pruned automatically.
- An edit rejected in the browser is shown as a recoverable draft. External reloads clear whole-board undo history to avoid undoing someone else's changes.
- Notes and boards are not one multi-file transaction.

Obsidian does not participate in the Better Canvas lock. Checks immediately before replacement catch ordinary saved-file conflicts, but cannot provide a cross-application atomic transaction or observe an Obsidian edit that has not yet been saved. Finish an edit in one application before editing the same card in the other. Recovery history is not a substitute for a vault backup.

## AI handoff

Click a card, Shift-select multiple cards, then right-click → **Ask AI about selection**. Copy the stable reference into the existing chat. The AI resolves it with `read_reference`. `get_selection` provides the current browser selection; multiple tabs require a session ID.

Native host-browser annotations are also usable, but the host controls that UI. Stable node IDs are exposed on DOM elements. A normal browser page cannot assume access to the host chat input or native attachment format. This plugin does not claim automatic insertion of a native chat attachment.

The plugin starts a local MCP process and can launch its preview service. It is intended for locally executed desktop chats; web/mobile and the public OpenAI plugin directory are not implied by GitHub availability. Public directory submission is a separate process.
