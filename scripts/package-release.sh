#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
mkdir -p outputs/releases
# Build locally: no package installation or bundling on the small science VM.
COPYFILE_DISABLE=1 tar --no-xattrs -C dist/standalone -czf outputs/releases/earthsignal-web.tar.gz .
printf 'Release: %s\n' "$PWD/outputs/releases/earthsignal-web.tar.gz"
