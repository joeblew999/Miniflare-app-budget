#!/bin/bash
# Cloud sessions start with no node_modules and none of the tools in mise.toml (fnox, Node 24), so
# env:lease works but worker:preview can't run. This installs them; on a laptop it does nothing.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
export PATH="$HOME/.local/bin:$PATH"

command -v mise >/dev/null || curl -fsSL https://mise.run | sh
mise trust --yes mise.toml
mise install --yes
# Put mise's tools ahead of the container's own Node for the rest of the session.
echo "export PATH=\"$(mise bin-paths | paste -sd:):\$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

eval "$(mise env -s bash)"
npm install --no-audit --no-fund
