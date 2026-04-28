#!/bin/sh

set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/packages/catalyst-core/template"
PACKAGE_DIR="$ROOT_DIR/packages/catalyst-core"

# Install workspace dependencies
cd "$ROOT_DIR"
npm ci

# Install template dependencies
cd "$FIXTURE_DIR"
npm ci
cd "$ROOT_DIR"

# Build catalyst-core
npm run prepare --workspace packages/catalyst-core

# Replace built catalyst-core in the fixture app
rm -rf "$FIXTURE_DIR/node_modules/catalyst-core/dist"
mv "$PACKAGE_DIR/dist" "$FIXTURE_DIR/node_modules/catalyst-core/"

# Run fixture app checks
cd "$FIXTURE_DIR"
npm run build
npm run test
