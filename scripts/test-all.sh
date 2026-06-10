#!/usr/bin/env bash
# Run all tests for any catalyst example app.
#
# Usage:
#   scripts/test-all.sh <example-app-path> [options]
#
# Options:
#   --only <suite>            Run a single suite (web|build|native)
#   --catalyst-version <ver>  Install a published npm version instead of syncing
#   --skip-native-tests       Skip gradlew test + xcodebuild test (run build/install but not unit tests)
#
# When run as the orchestrator, test-all.sh owns:
#   1. sync catalyst-core (once)
#   2. setupEmulator for each platform
#   3. start JS dev server (background, single PID)
#   4. delegate to test-web.sh / test-build.sh / test-native.sh
#   5. kill server
#   6. combined summary

set -euo pipefail

CYAN='\033[36m'; YELLOW='\033[33m'; GREEN='\033[32m'; RED='\033[31m'; RESET='\033[0m'
header() { printf "\n${CYAN}══ %s ══${RESET}\n" "$1"; }
ok()     { printf "  ${GREEN}✔ %s${RESET}\n" "$1"; }
warn()   { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; }
fail()   { printf "  ${RED}✖ %s${RESET}\n" "$1"; }
info()   { printf "  %s\n" "$1"; }

# ── argument parsing ──────────────────────────────────────────────────────────
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    fail "Usage: scripts/test-all.sh <example-app-path> [--only web|build|native]"
    exit 1
fi

APP_PATH="$1"; shift

ONLY_SUITE=""
CATALYST_VERSION=""
SKIP_NATIVE_TESTS=0
while [ $# -gt 0 ]; do
    case "$1" in
        --only)
            [ $# -lt 2 ] && { fail "--only requires a suite (web|build|native)"; exit 1; }
            ONLY_SUITE="$2"; shift 2 ;;
        --catalyst-version)
            [ $# -lt 2 ] && { fail "--catalyst-version requires a version string"; exit 1; }
            CATALYST_VERSION="$2"; shift 2 ;;
        --skip-native-tests) SKIP_NATIVE_TESTS=1; shift ;;
        *) fail "Unknown flag: $1"; exit 1 ;;
    esac
done

if [ -n "$ONLY_SUITE" ] && [ "$ONLY_SUITE" != "web" ] && [ "$ONLY_SUITE" != "build" ] && [ "$ONLY_SUITE" != "native" ]; then
    fail "Unknown suite: $ONLY_SUITE  (valid: web | build | native)"
    exit 1
fi

should_run() { [ -z "$ONLY_SUITE" ] || [ "$ONLY_SUITE" = "$1" ]; }

SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT_DIR="$SCRIPTS_DIR/.."
APP_DIR="$ROOT_DIR/$APP_PATH"

if [ ! -f "$APP_DIR/package.json" ]; then
    fail "No package.json found at $APP_DIR"
    exit 1
fi

RESULTS_FILE=$(mktemp)
trap 'rm -f "$RESULTS_FILE"' EXIT

printf "\n${CYAN}test-all.sh — %s${RESET}\n" "$APP_PATH"

# ── helpers ───────────────────────────────────────────────────────────────────
has_script() {
    node -e "
        const s=require('$APP_DIR/package.json').scripts||{};
        process.exit(s['$1']?0:1);
    " 2>/dev/null
}

get_port() {
    local key="$1" default="$2"
    node -e "
        try { const c=require('$APP_DIR/config/config.json'); console.log(c['$key']||$default); }
        catch(e){ console.log($default); }
    " 2>/dev/null || echo "$default"
}

kill_listener() {
    local port="$1"
    lsof -ti tcp:"$port" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
}

# run_server <script-name> <port> <pid-var> — backgrounds the server, assigns PID in-shell (no $() hang)
run_server() {
    local name="$1" port="$2" pid_var="$3"
    kill_listener "$port"
    sleep 1
    local log; log=$(mktemp)
    set -m
    { (cd "$APP_DIR" && npm run "$name" >"$log" 2>&1); } &
    local pid=$!
    set +m
    sleep 5
    if kill -0 "$pid" 2>/dev/null; then
        ok "$name (port $port)"; eval "$pid_var=$pid"; rm -f "$log"
    else
        fail "$name"
        grep -m3 "Error\|EADDR\|failed" "$log" || head -5 "$log"
        rm -f "$log"; eval "$pid_var="; return 1
    fi
}

kill_server() {
    local pid="${1:-}"
    [ -z "$pid" ] && return
    { kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; } 2>/dev/null
    wait "$pid" 2>/dev/null || true
}

# ── 1. sync catalyst-core ─────────────────────────────────────────────────────
header "Sync catalyst-core"
if [ -n "$CATALYST_VERSION" ]; then
    info "Installing catalyst-core@$CATALYST_VERSION from npm"
    (cd "$APP_DIR" && npm install "catalyst-core@$CATALYST_VERSION" --save-exact --silent 2>&1)
    ok "Installed catalyst-core@$CATALYST_VERSION"
else
    info "Building current branch and syncing into $APP_PATH/node_modules"
    sync_log=$(mktemp)
    if (cd "$APP_DIR" && node ../sync-core.js >"$sync_log" 2>&1); then
        ok "catalyst-core synced from current branch"
    else
        fail "catalyst-core sync failed"; cat "$sync_log"; rm -f "$sync_log"; exit 1
    fi
    rm -f "$sync_log"
fi

# Build suite-specific pass-through args
PASS_VERSION=()
[ -n "$CATALYST_VERSION" ] && PASS_VERSION=("--catalyst-version" "$CATALYST_VERSION")
PASS_SKIP_NATIVE_TESTS=()
[ "$SKIP_NATIVE_TESTS" -eq 1 ] && PASS_SKIP_NATIVE_TESTS=("--skip-native-tests")

# ── 2. web suite (no emulator/server needed) ──────────────────────────────────
if should_run "web"; then
    bash "$SCRIPTS_DIR/test-web.sh" "$APP_PATH" \
        --skip-sync \
        "${PASS_VERSION[@]+"${PASS_VERSION[@]}"}" \
        --results-file "$RESULTS_FILE" || true
fi

# ── 3. setup emulators ────────────────────────────────────────────────────────
# Only needed for build and native suites
if should_run "build" || should_run "native"; then
    header "Setup emulators"

    if has_script "setupEmulator:android"; then
        info "→ setupEmulator:android"
        setup_log=$(mktemp)
        if (cd "$APP_DIR" && npm run setupEmulator:android >"$setup_log" 2>&1); then
            ok "setupEmulator:android"; rm -f "$setup_log"
        else
            fail "setupEmulator:android"; cat "$setup_log"; rm -f "$setup_log"
            warn "android emulator setup failed — build/native suites will attempt anyway"
        fi
    else
        warn "setupEmulator:android not found — assuming emulator is already running"
    fi

    if has_script "setupEmulator:ios"; then
        info "-> setupEmulator:ios"
        setup_log=$(mktemp)
        if (cd "$APP_DIR" && npm run setupEmulator:ios >"$setup_log" 2>&1); then
            ok "setupEmulator:ios"; rm -f "$setup_log"
        else
            fail "setupEmulator:ios"; cat "$setup_log"; rm -f "$setup_log"
            warn "ios simulator setup failed — build/native suites will attempt anyway"
        fi
    else
        warn "setupEmulator:ios not found — assuming simulator is already running"
    fi
fi

# ── 4. start JS dev server ────────────────────────────────────────────────────
START_PID=""
if should_run "build" || should_run "native"; then
    header "Start JS dev server"
    server_port=$(get_port "NODE_SERVER_PORT" 3005)
    printf "  -> start\n"
    run_server "start" "$server_port" "START_PID" || {
        fail "JS dev server failed to start — build and native suites cannot run"
        echo "build:android|FAIL" >> "$RESULTS_FILE"
        echo "build:ios|FAIL"     >> "$RESULTS_FILE"
        echo "native:android|FAIL" >> "$RESULTS_FILE"
        echo "native:ios|FAIL"    >> "$RESULTS_FILE"
        START_PID=""
    }
fi

# ── 5a. build suite ───────────────────────────────────────────────────────────
if should_run "build" && [ -n "$START_PID" ]; then
    bash "$SCRIPTS_DIR/test-build.sh" "$APP_PATH" \
        --skip-sync --skip-setup --skip-start \
        "${PASS_VERSION[@]+"${PASS_VERSION[@]}"}" \
        --results-file "$RESULTS_FILE" || true
fi

# ── 5b. native suite ──────────────────────────────────────────────────────────
if should_run "native" && [ -n "$START_PID" ]; then
    bash "$SCRIPTS_DIR/test-native.sh" "$APP_PATH" \
        --skip-sync --skip-setup --skip-start \
        "${PASS_VERSION[@]+"${PASS_VERSION[@]}"}" \
        "${PASS_SKIP_NATIVE_TESTS[@]+"${PASS_SKIP_NATIVE_TESTS[@]}"}" \
        --results-file "$RESULTS_FILE" || true
fi

# ── 5. kill JS dev server ─────────────────────────────────────────────────────
if [ -n "$START_PID" ]; then
    kill_server "$START_PID"
fi

# ── 6. combined summary ───────────────────────────────────────────────────────
printf "\n${CYAN}══ Summary ══${RESET}\n"
printf "  %-16s %s\n" "GROUP" "STATUS"
printf "  %-16s %s\n" "────────────────" "──────"

final_exit=0
while IFS=| read -r group status; do
    case "$status" in
        PASS) color="$GREEN" ;;
        FAIL) color="$RED"; final_exit=1 ;;
        SKIP) color="$YELLOW" ;;
        *)    color="$RESET" ;;
    esac
    printf "  %-16s ${color}%-6s${RESET}\n" "$group" "$status"
done < "$RESULTS_FILE"

exit $final_exit
