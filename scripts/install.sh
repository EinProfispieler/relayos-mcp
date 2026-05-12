#!/usr/bin/env bash
# Print the MCP client registration snippets for RelayOS (relayos-mcp).
# This script does NOT modify ~/.claude.json or ~/.codex/config.toml — you copy
# the snippets in by hand to avoid clobbering other configured MCP servers.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dist="$repo_root/dist/index.js"

if [ ! -f "$dist" ]; then
  echo "error: $dist not found. Run 'npm run build' first." >&2
  exit 1
fi

cat <<EOF

╭── RelayOS (relayos-mcp) install snippets ───────────────────────────────╮

1) Claude Code — add this entry to "mcpServers" in ~/.claude.json:

  "relayos": {
    "type": "stdio",
    "command": "node",
    "args": ["$dist"]
  }

2) Codex CLI — append to ~/.codex/config.toml:

  [mcp_servers.relayos]
  type = "stdio"
  command = "node"
  args = ["$dist"]

Optional: override storage location with HANDOFF_DIR.
  Default: ~/.claude/handoff/
  Set HANDOFF_DIR=/path/to/dir in the "env" field of each MCP entry to override.

╰─────────────────────────────────────────────────────────────────────────╯

EOF
