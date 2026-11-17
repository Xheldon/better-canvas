# Privacy

Better Canvas runs on the local computer and accesses the vault folder selected by the user. The default preview binds to `127.0.0.1`. It does not collect analytics or require an AI-provider API key. It does not automatically upload a vault.

When an AI client calls MCP tools, the requested card or note content is returned to that client and is subject to the client's data handling. Copying a reference into chat permits the connected client to resolve the referenced cards. Local previews of remote images or links may contact their original hosts.

Browser selections, references, recovery history, and upstream coordination files are kept in `.better-canvas/` and `.canvai/` inside the selected vault. Exclude them from public repositories. History may contain previous sensitive text; manage it according to the same policy as your vault.

The source project includes upstream optional telemetry and agent-spawning capabilities. Both are disabled by default; the Better Canvas UI does not launch a separate agent. Do not expose the local service to an untrusted network.
