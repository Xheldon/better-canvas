# Privacy and file access

- The user explicitly chooses a local vault folder. The server does not scan unrelated folders.
- Local preview binds only to 127.0.0.1 and checks Host, Origin and cross-site request headers.
- Browser APIs read files or update selection/reference metadata. They cannot edit, upload, delete, rename or create vault content.
- File access rejects hidden paths, path traversal and symlink escapes.
- AI edits use stdio MCP. A host must enforce model-only tool visibility and its own tool permissions.
- No analytics, telemetry, API keys, remote image loading or agent subprocesses are included.
- A user-triggered Send in an MCP App passes the instruction and card reference to the current host conversation. Resolving that reference allows that AI to read the selected local content.
- .better-canvas contains temporary selections, stable reference snapshots and previous file versions for recovery. It stays local unless the user syncs the vault folder elsewhere. Do not publish it.
- Releases use an explicit file allowlist and exclude vaults and .local evaluations.
