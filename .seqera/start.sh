#!/usr/bin/env bash
set -euo pipefail

echo "Starting OpenCode Studio..."
echo "CONNECT_TOOL_PORT=${CONNECT_TOOL_PORT:-unset}"
echo "OPENCODE_VERSION=$(/usr/local/bin/opencode --version 2>/dev/null || echo unknown)"

if [[ -z "${CONNECT_TOOL_PORT:-}" ]]; then
  echo "Error: CONNECT_TOOL_PORT environment variable is not set"
  exit 1
fi

WORKDIR="${STUDIO_WORKDIR:-/workspace}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "Working directory: $PWD"

# If a Git repo is present and OpenCode project ID is known, write the project
# ID into .git/opencode so future workspace-aware flows can associate requests.
if [[ -n "${OPENCODE_PROJECT_ID:-}" && -d .git ]]; then
  echo "Writing .git/opencode from OPENCODE_PROJECT_ID"
  printf '%s\n' "$OPENCODE_PROJECT_ID" > .git/opencode
fi

# Optional diagnostic logging for future plugin integration.
if env | grep -q '^OPENCODE_'; then
  echo "Detected OPENCODE_* environment variables:"
  env | grep '^OPENCODE_' | sort
fi

# For the initial POC, assume Seqera Git integration or Studio remoteConfig has
# already materialized the repository into the working directory.
if [[ ! -d .git ]]; then
  echo "Warning: no .git directory found in $PWD"
  echo "This image assumes the repository has already been materialized by Seqera Studio Git integration or another bootstrap step."
fi

# Run OpenCode headless server on the Seqera-assigned tool port.
exec /usr/local/bin/opencode serve \
  --hostname 0.0.0.0 \
  --port "${CONNECT_TOOL_PORT}" \
  --print-logs
