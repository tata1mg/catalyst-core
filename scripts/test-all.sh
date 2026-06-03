#!/usr/bin/env bash
# Run all tests for any catalyst example app.
# Delegates to test-web.sh and test-native.sh.
#
# Usage:
#   scripts/test-all.sh <example-app-path> [options]
#
# Options:
#   --only <suite>            Run a single suite (web|native)
#   --catalyst-version <ver>  Install a published npm version instead of syncing
#
# Examples:
#   scripts/test-all.sh examples/test-video-hook-poc
#   scripts/test-all.sh examples/test-video-hook-poc --only web
#   scripts/test-all.sh examples/test-video-hook-poc --only native
#   scripts/test-all.sh examples/test-video-hook-poc --catalyst-version 0.1.0-canary.7

set -euo pipefail

CYAN='\033[36m'; RED='\033[31m'; RESET='\033[0m'
fail() { printf "  \033[31m✖ %s\033[0m\n" "$1"; }

if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    fail "Usage: scripts/test-all.sh <example-app-path> [--only web|native]"
    exit 1
fi

APP_PATH="$1"; shift

ONLY_SUITE=""
PASS_THROUGH=()
while [ $# -gt 0 ]; do
    case "$1" in
        --only)
            [ $# -lt 2 ] && { fail "--only requires a suite (web|native)"; exit 1; }
            ONLY_SUITE="$2"; shift 2 ;;
        --catalyst-version)
            [ $# -lt 2 ] && { fail "--catalyst-version requires a version string"; exit 1; }
            PASS_THROUGH+=("--catalyst-version" "$2"); shift 2 ;;
        *) fail "Unknown flag: $1"; exit 1 ;;
    esac
done

if [ -n "$ONLY_SUITE" ] && [ "$ONLY_SUITE" != "web" ] && [ "$ONLY_SUITE" != "native" ]; then
    fail "Unknown suite: $ONLY_SUITE  (valid: web | native)"
    exit 1
fi

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
web_exit=0
native_exit=0

printf "\n${CYAN}test-all.sh — %s${RESET}\n" "$APP_PATH"

if [ -z "$ONLY_SUITE" ] || [ "$ONLY_SUITE" = "web" ]; then
    bash "$SCRIPTS_DIR/test-web.sh" "$APP_PATH" "${PASS_THROUGH[@]}" || web_exit=$?
fi

if [ -z "$ONLY_SUITE" ] || [ "$ONLY_SUITE" = "native" ]; then
    bash "$SCRIPTS_DIR/test-native.sh" "$APP_PATH" "${PASS_THROUGH[@]}" || native_exit=$?
fi

[ $web_exit -eq 0 ] && [ $native_exit -eq 0 ] && exit 0 || exit 1
