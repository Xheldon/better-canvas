# Compatibility

## JSON Canvas 1.0

The preview reads the original x, y, width and height directly. It does not assign a grid, infer new positions, reparent cards or run layout. Nodes render in source array order. Groups use their original rectangles, including nested and overlapping rectangles.

Supported:
- Text cards rendered as sanitized Markdown, local Markdown/text file cards (including heading and block excerpts), raster image cards, URL cards and group labels.
- Negative coordinates, original dimensions and six preset colors or hex colors.
- Edge endpoints, sides, labels, fromEnd and toEnd (including no arrow and arrows at both ends).
- Pan, pointer-centered zoom, click/Shift-click selection, Shift-drag selection, fit all and focus selected.
- Space+drag or middle-button pan; Cmd/Ctrl+A selects cards; Escape clears selection. None of the editing shortcuts write content.

Differences from Obsidian:
- Fonts, line wrapping and SVG curve routing can differ.
- Obsidian themes, CSS snippets, plugin node renderers and Advanced Canvas visuals are not reproduced.
- Internal wiki links are displayed as text; external links do not embed websites.
- SVG/PDF/audio/video and remote images are not rendered as file previews. Raster images are limited to 5 MB, notes to 2 MB.
- Mermaid fences appear as code.
- Group backgrounds support basic local raster images; Obsidian repeat/ratio styling is not reproduced exactly.
- Nodes outside the visible viewport are present in the scene. Large vaults or thousands of cards have not been performance-qualified.

Unknown JSON fields are retained when a supported field is edited. Unsupported visual properties are preserved, not interpreted. Invalid geometry or dangling edges are reported rather than silently repaired.

## Source of truth

Canvas and linked note files on disk are authoritative. Browser selection and references are stored in .better-canvas and do not alter those files. A reference snapshots exact IDs and the version visible when the request was sent.

MCP writes require expectedRevision. Obsidian does not take our lock; concurrent native unsaved edits are not a shared transaction. Keep only one editor actively saving a file while AI applies changes.

## Host integration

open_canvas registers a text/html;profile=mcp-app resource and a conversation-panel entrypoint. The UI communicates through the standard MCP Apps SDK.

The composer checks the host's text-message capability, calls ui/message on explicit user submission, and waits for acknowledgment. The current conversation is the standard target; it never starts a new chat or local agent.

start_preview creates a plain localhost browser page. That page has no host message bridge and its Send button is disabled. Selection remains available to get_selection for a connected MCP client.

Installing the plugin and opening a localhost URL are not proof that a host has loaded the MCP App panel. Host UI acceptance must be checked separately.
