#!/bin/sh

set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

cd "$ROOT_DIR"
npm ci

# @catalyst/ai ships src/ directly with no build step — verify it installs
# cleanly as a workspace member (including its preinstall peer-check script)
# and that every JS file parses. It's ESM ("type": "module"), so plain
# `node --check` doesn't reliably catch its syntax; esbuild does.
for f in packages/catalyst-ai/src/*.js packages/catalyst-ai/scripts/*.js; do
    npx esbuild --bundle --platform=node --format=esm --packages=external --outfile=/dev/null "$f"
done
