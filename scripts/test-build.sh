#!/usr/bin/env bash
# Validate the native build pipeline for any catalyst example app.
#
# Usage:
#   scripts/test-build.sh <example-app-path> [options]
#
# Options:
#   --only <platform>         Run a single platform (android|ios)
#   --catalyst-version <ver>  Install a published npm version instead of syncing
#   --skip-sync               Skip catalyst-core sync (already done by test-all.sh)
#   --skip-setup              Skip setupEmulator steps (already done by test-all.sh)
#   --skip-start              Skip starting the JS dev server (already done by test-all.sh)
#   --results-file <path>     Append group:STATUS lines here (suppresses local summary)
#
# Standalone flow per platform:
#   1. setupEmulator:<platform>
#   2. start JS dev server (background)
#   3. buildApp:<platform>
#   4. kill server

set -euo pipefail

CYAN='\033[36m'; YELLOW='\033[33m'; GREEN='\033[32m'; RED='\033[31m'; RESET='\033[0m'
header() { printf "\n${CYAN}══ %s ══${RESET}\n" "$1"; }
ok()     { printf "  ${GREEN}✔ %s${RESET}\n" "$1"; }
warn()   { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; }
fail()   { printf "  ${RED}✖ %s${RESET}\n" "$1"; }
info()   { printf "  %s\n" "$1"; }

# ── argument parsing ──────────────────────────────────────────────────────────
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    fail "Usage: scripts/test-build.sh <example-app-path> [--only android|ios]"
    exit 1
fi

APP_PATH="$1"; shift

ONLY_PLATFORM=""
CATALYST_VERSION=""
SKIP_SYNC=0
SKIP_SETUP=0
SKIP_START=0
RESULTS_FILE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --only)
            [ $# -lt 2 ] && { fail "--only requires a platform (android|ios)"; exit 1; }
            ONLY_PLATFORM="$2"; shift 2 ;;
        --catalyst-version)
            [ $# -lt 2 ] && { fail "--catalyst-version requires a version string"; exit 1; }
            CATALYST_VERSION="$2"; shift 2 ;;
        --skip-sync)  SKIP_SYNC=1;  shift ;;
        --skip-setup) SKIP_SETUP=1; shift ;;
        --skip-start) SKIP_START=1; shift ;;
        --results-file)
            [ $# -lt 2 ] && { fail "--results-file requires a path"; exit 1; }
            RESULTS_FILE="$2"; shift 2 ;;
        *) fail "Unknown flag: $1"; exit 1 ;;
    esac
done

if [ -n "$ONLY_PLATFORM" ] && [ "$ONLY_PLATFORM" != "android" ] && [ "$ONLY_PLATFORM" != "ios" ]; then
    fail "Unknown platform: $ONLY_PLATFORM  (valid: android | ios)"
    exit 1
fi

should_run() { [ -z "$ONLY_PLATFORM" ] || [ "$ONLY_PLATFORM" = "$1" ]; }

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
APP_DIR="$ROOT_DIR/$APP_PATH"

if [ ! -f "$APP_DIR/package.json" ]; then
    fail "No package.json found at $APP_DIR"
    exit 1
fi

# ── helpers ───────────────────────────────────────────────────────────────────
declare -a RESULTS=()

record() {
    RESULTS+=("${1}|${2}")
    [ -n "$RESULTS_FILE" ] && echo "${1}|${2}" >> "$RESULTS_FILE"
    return 0
}

has_script() {
    node -e "
        const s=require('$APP_DIR/package.json').scripts||{};
        process.exit(s['$1']?0:1);
    " 2>/dev/null
}

run_step() {
    local label="$1" script="$2"
    printf "  → %s\n" "$label"
    local log; log=$(mktemp)
    if (cd "$APP_DIR" && npm run "$script" >"$log" 2>&1); then
        ok "$label"; rm -f "$log"; return 0
    else
        fail "$label"; cat "$log"; rm -f "$log"; return 1
    fi
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

# ── sync catalyst-core ────────────────────────────────────────────────────────
sync_catalyst_core() {
    header "Sync catalyst-core"
    if [ -n "$CATALYST_VERSION" ]; then
        info "Installing catalyst-core@$CATALYST_VERSION from npm"
        (cd "$APP_DIR" && npm install "catalyst-core@$CATALYST_VERSION" --save-exact --silent 2>&1)
        ok "Installed catalyst-core@$CATALYST_VERSION"
    else
        info "Building current branch and syncing into $APP_PATH/node_modules"
        local sync_log; sync_log=$(mktemp)
        if (cd "$APP_DIR" && node ../sync-core.js >"$sync_log" 2>&1); then
            ok "catalyst-core synced from current branch"
        else
            fail "catalyst-core sync failed"; cat "$sync_log"; rm -f "$sync_log"; exit 1
        fi
        rm -f "$sync_log"
    fi
}

# ── main ──────────────────────────────────────────────────────────────────────
printf "\n${CYAN}test-build.sh — %s${RESET}\n" "$APP_PATH"

[ "$SKIP_SYNC" -eq 0 ] && sync_catalyst_core

# Standalone: setup emulators
if [ "$SKIP_SETUP" -eq 0 ]; then
    header "Setup emulators"
    if should_run "android" && has_script "setupEmulator:android"; then
        run_step "setupEmulator:android" "setupEmulator:android" || {
            record "build:android" "FAIL"
            ONLY_PLATFORM="ios"  # skip android from here on
        }
    fi
    if should_run "ios" && has_script "setupEmulator:ios"; then
        run_step "setupEmulator:ios" "setupEmulator:ios" || {
            record "build:ios" "FAIL"
            [ -z "$ONLY_PLATFORM" ] && ONLY_PLATFORM="android" || ONLY_PLATFORM=""
        }
    fi
fi

# Standalone: start JS dev server
START_PID=""
if [ "$SKIP_START" -eq 0 ]; then
    header "Start JS dev server"
    server_port=$(get_port "NODE_SERVER_PORT" 3005)
    printf "  → start\n"
    run_server "start" "$server_port" "START_PID" || {
        fail "JS dev server failed — cannot run builds"
        should_run "android" && record "build:android" "FAIL"
        should_run "ios"     && record "build:ios"     "FAIL"
        exit 1
    }
fi

# ── Android build ─────────────────────────────────────────────────────────────
if should_run "android"; then
    header "Build: android"
    if has_script "buildApp:android"; then
        if run_step "buildApp:android" "buildApp:android"; then
            record "build:android" "PASS"
        else
            record "build:android" "FAIL"
        fi
    else
        warn "buildApp:android not found — skipping"
        record "build:android" "SKIP"
    fi
fi

# ── iOS build ─────────────────────────────────────────────────────────────────
if should_run "ios"; then
    header "Build: ios"
    if has_script "buildApp:ios"; then
        if run_step "buildApp:ios" "buildApp:ios"; then
            record "build:ios" "PASS"
        else
            record "build:ios" "FAIL"
        fi
    else
        warn "buildApp:ios not found — skipping"
        record "build:ios" "SKIP"
    fi
fi

# Standalone: kill server
[ "$SKIP_START" -eq 0 ] && kill_server "$START_PID"

# Print standalone summary only when not delegated from test-all.sh
if [ -z "$RESULTS_FILE" ]; then
    printf "\n${CYAN}══ Summary ══${RESET}\n"
    printf "  %-12s %s\n" "PLATFORM" "STATUS"
    printf "  %-12s %s\n" "────────────" "──────"
    for entry in "${RESULTS[@]}"; do
        platform="${entry%%|*}"
        status="${entry##*|}"
        case "$status" in
            PASS) color="$GREEN" ;;
            FAIL) color="$RED" ;;
            SKIP) color="$YELLOW" ;;
            *)    color="$RESET" ;;
        esac
        printf "  %-16s ${color}%s${RESET}\n" "$platform" "$status"
    done
fi

final_exit=0
for entry in "${RESULTS[@]}"; do
    [[ "${entry##*|}" == "FAIL" ]] && final_exit=1
done
exit $final_exit
