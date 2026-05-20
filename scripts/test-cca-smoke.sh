#!/bin/sh

set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cca-smoke.XXXXXX")
APP_DIR="$TMP_DIR/my-app"

cleanup() {
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT

cd "$ROOT_DIR"

npm ci
npm run prepare --workspace packages/catalyst-core

CORE_VERSION=$(node -p "require('./packages/catalyst-core/package.json').version")

npm pack --workspace packages/catalyst-core --pack-destination "$TMP_DIR" --silent >/dev/null

export GIT_AUTHOR_NAME="github-actions[bot]"
export GIT_AUTHOR_EMAIL="github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

cd "$TMP_DIR"
CREATE_CATALYST_APP_PACK_SOURCE=local node "$ROOT_DIR/packages/create-catalyst-app/scripts/cli.cjs" smoke-app -y

cd "$APP_DIR"
npm install "$TMP_DIR/catalyst-core-$CORE_VERSION.tgz"
npm run build
