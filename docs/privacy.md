# Privacy and file access

- The user explicitly chooses a local working directory, with or without Obsidian. The server does not scan unrelated folders or search parent directories for assets.
- The chosen directory is remembered in `~/.config/better-canvas/settings.json` (or `BETTER_CANVAS_SETTINGS`). It is not bundled in releases. The current directory is visible in Settings and returned to the connected AI host in preview metadata.
- Local preview binds only to 127.0.0.1 and checks Host, Origin and cross-site request headers.
- Browser APIs read files, update selection/reference metadata, or change the user-selected directory preference. They cannot edit, upload, delete, rename or create source content.
- File access rejects hidden paths, path traversal and symlink escapes.
- AI edits use stdio MCP. A host must enforce model-only tool visibility and its own tool permissions.
- Writes and references check the working-directory identity as well as file revisions. Old panels cannot silently target a same-named file after a directory switch. Directory switches are serialized with in-flight MCP writes in that service.
- No analytics, telemetry, API keys, remote image loading or agent subprocesses are included.
- A user-triggered Send in an MCP App passes the instruction and card reference to the current host conversation. Resolving that reference allows that AI to read the selected local content.
- .better-canvas contains temporary selections, stable reference snapshots and previous file versions for recovery. It stays local unless the user syncs the vault folder elsewhere. Do not publish it.
- Releases use an explicit file allowlist and exclude vaults and .local evaluations.
