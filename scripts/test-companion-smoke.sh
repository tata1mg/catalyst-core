#!/bin/sh

# Companion app CI smoke check: install monorepo deps (workspace babel
# toolchain for core's build), then sync-core (build+pack+install core into
# the app), lint, and production-build. No device build, no automated tests.

set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
APP_DIR="$ROOT_DIR/apps/catalyst-companion"

cd "$ROOT_DIR"
npm ci

cd "$APP_DIR"
npm run sync-core
npm run lint
npm run build
npm run docs:check-links -- --strict
