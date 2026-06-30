#!/usr/bin/env bash
# Test the JS/web layer of any catalyst example app.
#
# Usage:
#   scripts/test-web.sh <example-app-path> [options]
#
# Options:
#   --only <group>            Run a single group (build|serve|js-tests)
#   --catalyst-version <ver>  Install a published npm version instead of syncing
#
# Groups:
#   build     — build + devBuild
#   serve     — serve + devServe + start
#   js-tests  — test / test:unit / test:integration / test:e2e

set -euo pipefail

CYAN='\033[36m'; YELLOW='\033[33m'; GREEN='\033[32m'; RED='\033[31m'; RESET='\033[0m'
header() { printf "\n${CYAN}══ %s ══${RESET}\n" "$1"; }
ok()     { printf "  ${GREEN}✔ %s${RESET}\n" "$1"; }
warn()   { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; }
fail()   { printf "  ${RED}✖ %s${RESET}\n" "$1"; }
info()   { printf "  %s\n" "$1"; }

# ── argument parsing ──────────────────────────────────────────────────────────
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    fail "Usage: scripts/test-web.sh <example-app-path> [--only <group>]"
    fail "Groups: build | serve | js-tests"
    exit 1
fi

APP_PATH="$1"; shift

ONLY_GROUP=""
CATALYST_VERSION=""
SKIP_SYNC=0
RESULTS_FILE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --only)
            [ $# -lt 2 ] && { fail "--only requires a group name"; exit 1; }
            ONLY_GROUP="$2"; shift 2 ;;
        --catalyst-version)
            [ $# -lt 2 ] && { fail "--catalyst-version requires a version string"; exit 1; }
            CATALYST_VERSION="$2"; shift 2 ;;
        --skip-sync) SKIP_SYNC=1; shift ;;
        --results-file)
            [ $# -lt 2 ] && { fail "--results-file requires a path"; exit 1; }
            RESULTS_FILE="$2"; shift 2 ;;
        *) fail "Unknown flag: $1"; exit 1 ;;
    esac
done

VALID_GROUPS="build serve js-tests"
if [ -n "$ONLY_GROUP" ]; then
    found=0
    for g in $VALID_GROUPS; do [ "$g" = "$ONLY_GROUP" ] && found=1 && break; done
    [ $found -eq 0 ] && { fail "Unknown group: $ONLY_GROUP  (valid: $VALID_GROUPS)"; exit 1; }
fi

should_run() { [ -z "$ONLY_GROUP" ] || [ "$ONLY_GROUP" = "$1" ]; }

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
APP_DIR="$ROOT_DIR/$APP_PATH"

if [ ! -f "$APP_DIR/package.json" ]; then
    fail "No package.json found at $APP_DIR"
    exit 1
fi

# ── helpers ───────────────────────────────────────────────────────────────────
declare -a RESULTS=()

record() {
    RESULTS+=("${1}:${2}")
    [ -n "$RESULTS_FILE" ] && echo "${1}|${2}" >> "$RESULTS_FILE"
}

get_port() {
    local key="$1" default="$2"
    node -e "
        try { const c=require('$APP_DIR/config/config.json'); console.log(c['$key']||$default); }
        catch(e){ console.log($default); }
    " 2>/dev/null || echo "$default"
}

has_script() {
    node -e "
        const s=require('$APP_DIR/package.json').scripts||{};
        process.exit(s['$1']?0:1);
    " 2>/dev/null
}

run_step() {
    local name="$1"
    has_script "$name" || return 0
    printf "  → %s\n" "$name"
    local log; log=$(mktemp)
    if (cd "$APP_DIR" && npm run "$name" >"$log" 2>&1); then
        ok "$name"; rm -f "$log"
    else
        fail "$name"; cat "$log"; rm -f "$log"; return 1
    fi
}

# Kill only the LISTEN socket on a port — never connected clients (e.g. emulator)
kill_listener() {
    local port="$1"
    lsof -ti tcp:"$port" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
}

run_server() {
    local name="$1" port="$2" pid_var="$3"
    has_script "$name" || { eval "$pid_var="; return 0; }
    printf "  → %s\n" "$name"
    # kill previous listener(s) — shift past name/port/pid_var for extra ports
    shift 3
    kill_listener "$port"
    for p in "$@"; do kill_listener "$p"; done
    sleep 1
    local log; log=$(mktemp)
    set -m
    { (cd "$APP_DIR" && npm run "$name" >"$log" 2>&1); } &
    local pid=$!
    set +m
    sleep 5
    if kill -0 "$pid" 2>/dev/null; then
        ok "$name"; eval "$pid_var=$pid"; rm -f "$log"
    else
        fail "$name"
        grep -m3 "Error\|EADDR\|failed" "$log" || head -5 "$log"
        rm -f "$log"; eval "$pid_var="; return 1
    fi
}

kill_server() {
    local pid="$1"
    [ -z "$pid" ] && return
    { kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; } 2>/dev/null
    wait "$pid" 2>/dev/null || true
}

# ── sync catalyst-core ────────────────────────────────────────────────────────
sync_catalyst_core() {
    header "Sync catalyst-core"
    if [ -n "$CATALYST_VERSION" ]; then
        info "Installing catalyst-core@$CATALYST_VERSION from npm"
        rm -rf "$APP_DIR/node_modules/catalyst-core"
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

# ── Group: build ──────────────────────────────────────────────────────────────
group_build() {
    header "Group: build"
    local all_passed=1
    run_step "build"    || all_passed=0
    run_step "devBuild" || all_passed=0
    [ "$all_passed" -eq 1 ] && record "build" "PASS" || record "build" "FAIL"
}

# ── Group: serve ──────────────────────────────────────────────────────────────
group_serve() {
    header "Group: serve"
    local server_port webpack_port
    server_port=$(get_port "NODE_SERVER_PORT" 3005)
    webpack_port=$(get_port "WEBPACK_DEV_SERVER_PORT" 3006)

    local all_passed=1 serve_pid="" devserve_pid="" start_pid=""

    run_server "serve"    "$server_port"  "serve_pid"    || all_passed=0
    kill_server "${serve_pid:-}"; sleep 1

    run_server "devServe" "$webpack_port" "devserve_pid" "$server_port" || all_passed=0
    kill_server "${devserve_pid:-}"; sleep 1

    run_server "start" "$server_port" "start_pid" || all_passed=0
    kill_server "${start_pid:-}"; sleep 1

    [ "$all_passed" -eq 1 ] && record "serve" "PASS" || record "serve" "FAIL"
}

# ── Group: js-tests ───────────────────────────────────────────────────────────
group_js_tests() {
    header "Group: js-tests"
    local scripts
    scripts=$(node -e "
        const s=require('$APP_DIR/package.json').scripts||{};
        const keep=['test','test:unit','test:integration','test:e2e'];
        console.log(keep.filter(k=>s[k]).join('\n'));
    " 2>/dev/null)

    if [ -z "$scripts" ]; then
        warn "No test scripts found in package.json"
        record "js-tests" "SKIP"
        return
    fi

    local all_passed=1
    while IFS= read -r script; do
        printf "  → %s\n" "$script"
        local log; log=$(mktemp)
        if (cd "$APP_DIR" && npm run "$script" >"$log" 2>&1); then
            ok "$script"; rm -f "$log"
        else
            fail "$script"; cat "$log"; rm -f "$log"; all_passed=0
        fi
    done <<< "$scripts"

    [ "$all_passed" -eq 1 ] && record "js-tests" "PASS" || record "js-tests" "FAIL"
}

# ── main ──────────────────────────────────────────────────────────────────────
printf "\n${CYAN}test-web.sh — %s${RESET}\n" "$APP_PATH"

[ "$SKIP_SYNC" -eq 0 ] && sync_catalyst_core

should_run "build"    && group_build
should_run "serve"    && group_serve
should_run "js-tests" && group_js_tests

# Print standalone summary only when not delegated from test-all.sh
if [ -z "$RESULTS_FILE" ]; then
    printf "\n${CYAN}══ Summary ══${RESET}\n"
    printf "  %-14s %-6s\n" "GROUP" "STATUS"
    printf "  %-14s %-6s\n" "──────────────" "──────"
    for entry in "${RESULTS[@]}"; do
        group="${entry%%:*}"
        status="${entry##*:}"
        case "$status" in
            PASS) color="$GREEN" ;;
            FAIL) color="$RED" ;;
            SKIP) color="$YELLOW" ;;
        esac
        printf "  %-14s ${color}%-6s${RESET}\n" "$group" "$status"
    done
fi

final_exit=0
for entry in "${RESULTS[@]}"; do
    [[ "${entry##*:}" == "FAIL" ]] && final_exit=1
done
exit $final_exit
