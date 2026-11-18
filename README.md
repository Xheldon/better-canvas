# Better Canvas

A read-only JSON Canvas viewer with AI editing over MCP. Works with Obsidian vaults and ordinary folders.

Select cards, describe a change in the bottom composer, and let the AI in your current conversation update the source files. The preview follows the files on disk.

Built with **React, TypeScript and Vite**. Cards use an HTML layer and connections use SVG. There is no embedded canvas editor, automatic layout engine, separate chat sidebar, or spawned AI process.

![Browser preview with a folder tree, selected-card references and a bottom composer](docs/images/directory-tree.png)

## How it works

1. Choose a **working directory** in Settings, or tell AI the directory to open. The choice is remembered locally.
2. Open a Canvas in the conversation's MCP App panel.
3. Click a card, Shift-click to add/remove a card, or hold Shift and drag with the left mouse button from a card or empty space to select several. The rectangle adds intersecting cards to the existing selection.
4. Selected cards appear as reference chips above the bottom input.
5. Describe the change and press Enter. Shift+Enter inserts a newline; IME confirmation does not send.
6. The host receives a message containing an immutable card reference. AI reads the reference, applies revision-checked MCP edits, and the preview refreshes.

The sidebar preserves the original folder hierarchy and shows only Canvas files and their ancestor folders. Search keeps that hierarchy. Hidden folders and common generated folders are excluded. Settings are available even when the sidebar is collapsed.

The browser cannot move, resize, edit, delete, create, upload or paste cards. It has no content-writing HTTP endpoints. View metadata and directory preferences are stored separately.

Hold Cmd on macOS (Ctrl on Windows/Linux) while scrolling to zoom around the pointer. Scroll without a modifier to pan. Selection and zoom never change card positions in the source file.

### Two ways to view

| Surface | Preview and selection | Send to current chat |
| --- | --- | --- |
| MCP App panel in a compatible host | Yes | Uses the standard `ui/message` bridge |
| Local browser / localhost preview | Yes | Disabled: ordinary web pages do not have the host chat bridge |

The composer only reports a successful send after the host acknowledges it. A failed send retains the draft. Sending a request does not mean AI has applied it yet.

The plugin declares conversation-panel and `.canvas` file-viewer entrypoints through the OpenAI MCP UI extension, with fullscreen as the preferred presentation. File viewers resolve the exact file from host-provided metadata and enforce the selected vault boundary. Host support and plugin loading determine whether these entrypoints are available. Installing or updating a local plugin does not automatically reload an already-running conversation's MCP connection.

**Verified on one desktop environment:** on 2026-11-18, a user submitted a selected-card request through the native panel to the current conversation. AI resolved its immutable reference and edited the file through MCP; Obsidian's open Canvas and the panel's reported revision both updated. This was tested with ChatGPT desktop 26.1111.21308 (27194), Node.js 22.23.1 and Obsidian 1.15.1 on macOS. Other hosts and desktop versions are not covered by that result; see [testing](docs/testing.md).

If a tool returns data without a panel, try the host's **Better Canvas** conversation-panel entrypoint after reloading the plugin connection. The initial local attempt had MCP Apps disabled. A superficially similar symptom is tracked in [openai/codex#36765](https://github.com/openai/codex/issues/36765), but that is not an established cause for every missing panel. The localhost viewer cannot substitute for the host bridge.

On Codex builds that expose the experimental `enable_mcp_apps` feature, check it with `codex features list`. Enable it with `codex features enable enable_mcp_apps` if needed, then restart the desktop host and reopen the conversation so both the feature and updated plugin connection load. This enables UI support; it does not change MCP tool approvals. A CLI feature value alone does not establish that the desktop panel mounted successfully.

## Install

Requires **Node.js 22.18 or later**.

Download and unzip the [latest release](https://github.com/Xheldon/better-canvas/releases). The archive contains the complete server, browser UI and MCP App UI; no dependency installation is required.

For the Codex desktop local-plugin workflow:

```sh
codex plugin marketplace add /absolute/path/to/better-canvas --json
codex plugin add better-canvas@better-canvas-local --json
```

Then enable the plugin in a conversation and open Better Canvas. Use **Settings → Working directory** to paste your folder path, or ask AI to open the directory you provide. Obsidian is optional; no `.obsidian` folder is required. Reload the plugin connection after updating it.

For an Obsidian vault, select the **entire vault root**: its image/note paths are vault-relative. For an ordinary folder, references are relative to the selected working directory. The viewer never searches parent directories for missing assets. Switching directories clears the current selection and unsent draft; old references cannot edit a same-named file in the new directory.

See [installation and distribution](docs/distribution.md) for release ZIPs, source installation, and the official plugin-directory submission route.

For other MCP clients, register a stdio server:

```json
{
  "mcpServers": {
    "better-canvas": {
      "command": "node",
      "args": [
        "/absolute/path/to/better-canvas/packages/hub/dist/better-canvas.mjs",
        "mcp",
        "--select-vault"
      ]
    }
  }
}
```

Clients without MCP Apps can use the MCP tools and local read-only preview. The standalone composer does not pretend to send messages.

## Local development

```sh
npm ci
npm run build
node packages/hub/dist/better-canvas.mjs serve --root /absolute/path/to/vault --port 5199
```

Open `http://127.0.0.1:5199`. The server binds to loopback only. Use `?lang=en` or `?lang=zh` to override the browser language.

```sh
npm run typecheck
npm test
npm run build
npm run plugin:pack
npm run test:package
```

## MCP tools

- **Scope:** `open_vault`, `set_directory` (Settings), `list_boards`, `set_active_board`, `get_active_board`.
- **View:** `open_canvas` (MCP App), `start_preview` (browser), `get_preview`, `preview_file`.
- **File entrypoint:** `get_opened_canvas` is app-only and requires the host's `openai/resource.path` metadata.
- **Reference:** `save_selection`, `get_selection`, `create_reference`, `read_reference`.
- **Read/write through AI:** `read_board`, `apply_ops`, `create_board`, `read_note`, `update_note`.

Write tools are model-only in the MCP Apps visibility metadata. A normal MCP client remains responsible for authorizing its own tool calls.

Example after `read_board`:

```json
{
  "board": "Planning.canvas",
  "workspaceId": "<workspaceId returned by read_board>",
  "expectedRevision": "<revision returned by read_board>",
  "ops": [
    { "op": "update_node", "id": "card-id", "patch": { "text": "Updated text" } }
  ]
}
```

Operations include adding, updating and deleting nodes and edges. Adding needs complete records and explicit coordinates. Deleting a node also removes its attached edges. There is no implicit layout. Version 0.3 replaces the former semantic/rail operations; update clients to use `patch` objects.

Version 0.4 also requires `workspaceId` for content writes, file previews, selection/reference creation and setting the active board. Obtain it from a current preview/read response. A stale working directory is rejected even when both directories contain identical Canvas bytes. Existing stable references remain readable in their original directory.

## Illustrated flowcharts

Use a standard JSON Canvas `file` node for a local image, positioned beside the step it explains. A group rectangle can contain both cards; flow arrows continue connecting the steps. Referencing an image file does not create an edge.

If the AI host supports image generation and saving local files, it can save the generated image inside the working directory and add its file node through MCP. Better Canvas does not bundle a generation model or an upload endpoint. Existing PNG, JPEG, WebP, GIF and AVIF files are previewed (up to 5 MB each). Text-card image embeds are not rendered; use a file card. See [compatibility](docs/compatibility.md).

## Fidelity and storage

Original IDs, coordinates, dimensions, array order, group boundaries, edge sides and arrow ends are retained. Unknown JSON properties survive targeted edits. File serialization retains the detected indentation, colon spacing and final newline convention.

Rendering is structurally compatible with JSON Canvas, not a copy of Obsidian's renderer. Fonts, line wrapping, curve routing, custom themes, embeds and third-party plugin visuals may differ. See [compatibility](docs/compatibility.md).

Files on disk are the source of truth. Changes saved in Obsidian refresh the preview; MCP edits update those same files. Native unsaved buffers do not participate in our file lock. Revision checks reject observed competing changes and recovery copies are kept, but cross-application atomic transactions are not guaranteed.

See [privacy](docs/privacy.md) and [testing](docs/testing.md).

## Provenance

The project began as a canvai fork. Version 0.3 replaces its application framework, renderer, editor interactions, layout system and agent spawning. The JSON Canvas parsing/formatting code retains ideas and portions from the MIT-licensed project. The license and attribution remain in [NOTICE](NOTICE); the Git history is retained.

MIT License.
