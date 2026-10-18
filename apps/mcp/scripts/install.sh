#!/usr/bin/env bash
# Builds the MCP server, links it as ~/.local/bin/noted-mcp and registers it with Claude Code
# (user scope, so every project sees it). The key: run `noted-mcp setup` once.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
node "$here/scripts/build.mjs"
mkdir -p "$HOME/.local/bin"
ln -sf "$here/dist/noted-mcp.mjs" "$HOME/.local/bin/noted-mcp"
echo "Linked ~/.local/bin/noted-mcp"
if command -v claude >/dev/null; then
  if claude mcp get noted >/dev/null 2>&1; then
    echo "Claude Code already has the server \"noted\"."
  else
    claude mcp add --scope user noted -- node --disable-warning=ExperimentalWarning "$here/dist/noted-mcp.mjs"
  fi
fi
