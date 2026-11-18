# Install and distribute Better Canvas

## GitHub release ZIP

1. Install Node.js 22.18 or newer.
2. Download `better-canvas-<version>.zip` from [GitHub Releases](https://github.com/Xheldon/better-canvas/releases) and extract it into a permanent folder. It includes the server dependencies and both preview interfaces.
3. In a Codex installation with local-plugin support, register the extracted folder and install:

   ```sh
   codex plugin marketplace add /absolute/path/to/better-canvas --json
   codex plugin add better-canvas@better-canvas-local --json
   ```

4. Enable Better Canvas in a local conversation. Reload the host's plugin connection if it was already running. Ask to open Better Canvas, then choose **Settings → Working directory**.
5. Paste an absolute folder path (`~/` is supported on macOS/Linux). Obsidian users should select the entire vault root so vault-relative image and note references resolve. An ordinary folder also works.

Only Canvas files and folders containing them appear in the sidebar. No project folder is included in the download. The path preference stays on the user's computer. The extracted release includes its own local marketplace catalog, so this route does not require cloning or building the source repository.

MCP Apps support is required for the integrated composer. Other MCP clients can register the bundled stdio server using the configuration in the [README](../README.md); a browser-only preview cannot send to a host conversation. Installation menus and feature availability vary by host version. The tested environment is recorded in [testing](testing.md).

To update, extract the new release into the same permanent folder, repeat the local install command, and reload the plugin connection. Do not copy the example configuration over a real vault. Directory preferences and source Canvas files live outside the installed package.

## From source

```sh
git clone https://github.com/Xheldon/better-canvas.git
cd better-canvas
npm ci
npm run build
npm run plugin:pack
codex plugin marketplace add "$PWD" --json
codex plugin add better-canvas@better-canvas-local --json
```

The source repository's catalog points to the generated `dist/better-canvas` folder. Build and package it first; registering an unbuilt GitHub checkout is not sufficient.

For a standalone browser, run `npm run serve -- --port 5199` and choose the directory in Settings. Or use `--root /absolute/path/to/folder` to choose it at launch. The browser has selection, navigation and directory settings; AI content edits use MCP.

## Official OpenAI Plugin Directory

Better Canvas runs a local stdio MCP server, so the current submission route is **Desktop only**. As checked on 2026-11-18, OpenAI limits local MCP submissions to approved partners and requires organization allowlisting. Publishing a GitHub repository or a custom local marketplace does not list the plugin in the official directory. [Official desktop-only submission guide](https://developers.openai.com/plugins/deploy/desktop-only)

If eligible, confirm organization access with OpenAI, complete developer/business verification, test a clean installation, upload the packaged plugin through the portal's local-MCP route, and submit for review. Approval and the final publish action are separate. [Submission prerequisites](https://developers.openai.com/plugins/deploy/submission)

The release ZIP is for local installation. It contains a top-level `better-canvas` folder. For portal upload, create a ZIP whose root directly contains `plugin.json`, `mcp.json`, `skills/` and the bundled server, following the portal's package validation. Do not include local preferences, `.better-canvas`, user files or private screenshots.

This is a host plugin with a local file service; it is not an Obsidian Community Plugin. It does not need to be installed in Obsidian to read `.canvas` files. Submission to Obsidian's community list would require a separate Obsidian plugin package.

## Directory preferences

The selected directory is saved to `~/.config/better-canvas/settings.json`. `BETTER_CANVAS_SETTINGS` can override that path for tests or independent instances. A removed directory returns to the chooser on startup. `--root` explicitly selects and remembers a directory; without it, the service restores the saved choice. The older `--select-vault` launch argument remains accepted for compatibility.

One running service has one current directory. Switching it updates its connected browser and MCP panels. Separate service processes read the preference on startup; a preference file is not a live coordination bus between processes.
