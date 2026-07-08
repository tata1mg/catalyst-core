#!/bin/sh

set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/apps/catalyst-core-test"
PACK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/catalyst-core-test.XXXXXX")

cleanup() {
    rm -rf "$PACK_DIR"
}

trap cleanup EXIT

# Install workspace dependencies
cd "$ROOT_DIR"
npm ci

# Build catalyst-core
npm run prepare --workspace packages/catalyst-core

# Install template dependencies with current-branch catalyst-core
npm pack --workspace packages/catalyst-core --pack-destination "$PACK_DIR" --ignore-scripts --silent >/dev/null
CORE_TARBALL=$(find "$PACK_DIR" -name "catalyst-core-*.tgz" -print -quit)

cd "$FIXTURE_DIR"
npm install
npm install --no-save --package-lock=false "$CORE_TARBALL"

# Run fixture app checks
npm run build
npm run test
