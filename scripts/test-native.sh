#!/usr/bin/env bash
# Test the native layer (Android + iOS) of any catalyst example app.
#
# Usage:
#   scripts/test-native.sh <example-app-path> [options]
#
# Options:
#   --only <platform>         Run a single platform (android|ios)
#   --catalyst-version <ver>  Install a published npm version instead of syncing
#   --skip-native-tests       Skip gradlew test (android) and xcodebuild test (ios)
#
# Flow per platform:
#   1. setupEmulator:<platform>  — boot emulator/simulator
#   2. start                     — launch the JS dev server (kept alive)
#   3. buildApp:<platform>       — build and install the native app
#   4. native unit tests         — gradlew test (android) / xcodebuild test (ios)
#   5. kill start server

set -euo pipefail

CYAN='\033[36m'; YELLOW='\033[33m'; GREEN='\033[32m'; RED='\033[31m'; RESET='\033[0m'
header() { printf "\n${CYAN}══ %s ══${RESET}\n" "$1"; }
ok()     { printf "  ${GREEN}✔ %s${RESET}\n" "$1"; }
warn()   { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; }
fail()   { printf "  ${RED}✖ %s${RESET}\n" "$1"; }
info()   { printf "  %s\n" "$1"; }

# ── argument parsing ──────────────────────────────────────────────────────────
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    fail "Usage: scripts/test-native.sh <example-app-path> [--only android|ios]"
    exit 1
fi

APP_PATH="$1"; shift

ONLY_PLATFORM=""
CATALYST_VERSION=""
SKIP_SYNC=0
SKIP_SETUP=0
SKIP_START=0
SKIP_NATIVE_TESTS=0
RESULTS_FILE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --only)
            [ $# -lt 2 ] && { fail "--only requires a platform (android|ios)"; exit 1; }
            ONLY_PLATFORM="$2"; shift 2 ;;
        --catalyst-version)
            [ $# -lt 2 ] && { fail "--catalyst-version requires a version string"; exit 1; }
            CATALYST_VERSION="$2"; shift 2 ;;
        --skip-sync)         SKIP_SYNC=1;         shift ;;
        --skip-setup)        SKIP_SETUP=1;        shift ;;
        --skip-start)        SKIP_START=1;        shift ;;
        --skip-native-tests) SKIP_NATIVE_TESTS=1; shift ;;
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
NATIVE_ROOT="$APP_DIR/node_modules/catalyst-core/dist/native"
ANDROID_DIR="$NATIVE_ROOT/androidProject"
IOS_DIR="$NATIVE_ROOT/iosnativeWebView"

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

get_port() {
    local key="$1" default="$2"
    node -e "
        try { const c=require('$APP_DIR/config/config.json'); console.log(c['$key']||$default); }
        catch(e){ console.log($default); }
    " 2>/dev/null || echo "$default"
}

# Kill only the LISTEN socket on a port — never connected clients (e.g. emulator)
kill_listener() {
    local port="$1"
    lsof -ti tcp:"$port" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
}

run_step() {
    local name="$1"
    printf "  → %s\n" "$name"
    local log; log=$(mktemp)
    if (cd "$APP_DIR" && npm run "$name" >"$log" 2>&1); then
        ok "$name"; rm -f "$log"
    else
        fail "$name"; cat "$log"; rm -f "$log"; return 1
    fi
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

# ── Android ───────────────────────────────────────────────────────────────────
run_android() {
    header "Platform: android"
    local all_passed=1

    # 1. Native unit tests (JVM)
    if [ "$SKIP_NATIVE_TESTS" -eq 1 ]; then
        warn "gradlew test — skipped (--skip-native-tests)"
    elif [ -f "$ANDROID_DIR/gradlew" ]; then
        printf "  → gradlew test\n"
        local log; log=$(mktemp)
        if (cd "$ANDROID_DIR" && ./gradlew test --daemon >"$log" 2>&1); then
            ok "gradlew test"; rm -f "$log"
        else
            fail "gradlew test"; cat "$log"; rm -f "$log"; all_passed=0
        fi
    else
        warn "gradlew not found at $ANDROID_DIR — skipping JVM unit tests"
    fi

    [ "$all_passed" -eq 1 ] && record "native:android" "PASS" || record "native:android" "FAIL"
}

# ── iOS ───────────────────────────────────────────────────────────────────────
run_ios() {
    header "Platform: ios"
    local all_passed=1

    # 1. Native unit tests (XCTest)
    if [ "$SKIP_NATIVE_TESTS" -eq 1 ]; then
        warn "xcodebuild test — skipped (--skip-native-tests)"
    elif ! command -v xcodebuild >/dev/null 2>&1; then
        warn "xcodebuild not found — skipping iOS unit tests"
    elif [ ! -d "$IOS_DIR/iosnativeWebView.xcodeproj" ]; then
        warn "iOS project not found at $IOS_DIR — skipping XCTest"
    else
        local sim_id="" ios_scheme=""
        sim_id=$(xcrun simctl list devices booted 2>/dev/null \
            | grep -m1 "iPhone" \
            | grep -oE '[A-F0-9]{8}-([A-F0-9]{4}-){3}[A-F0-9]{12}' \
            || true)
        ios_scheme=$(node -e "
            try { const c=require('$APP_DIR/config/config.json');
                  console.log((c.WEBVIEW_CONFIG&&c.WEBVIEW_CONFIG.ios&&c.WEBVIEW_CONFIG.ios.scheme)||'iosnativeWebView'); }
            catch(e){ console.log('iosnativeWebView'); }
        " 2>/dev/null || echo "iosnativeWebView")
        if [ -z "$sim_id" ]; then
            warn "No booted iPhone simulator found — skipping XCTest"
        else
            # Build test bundle via buildIosForTesting (configure+provision+build-for-testing, no install)
            printf "  → buildIosForTesting\n"
            local bft_log; bft_log=$(mktemp)
            local bft_exit=0
            (cd "$APP_DIR" && node -e "
                const { createIosBuild } = require('${NATIVE_ROOT}/buildIos/index.js');
                const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require('./config/config.json');
                const build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH });
                build.buildIosForTesting().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
            " >"$bft_log" 2>&1) || bft_exit=$?
            if [ $bft_exit -ne 0 ]; then
                fail "buildIosForTesting"; cat "$bft_log"; rm -f "$bft_log"
                record "native:ios" "FAIL"; return
            fi
            ok "buildIosForTesting"; rm -f "$bft_log"

            local build_products="$HOME/Library/Developer/Xcode/DerivedData/iosnativeWebView-Build/Build/Products"
            printf "  → xcodebuild test-without-building (scheme: %s, sim: %s)\n" "$ios_scheme" "$sim_id"
            local xc_exit=0 xc_log; xc_log=$(mktemp)
            (cd "$IOS_DIR" && xcodebuild test-without-building \
                -project iosnativeWebView.xcodeproj \
                -scheme "$ios_scheme" \
                -sdk iphonesimulator \
                -configuration Debug \
                -destination "platform=iOS Simulator,id=$sim_id" \
                DEVELOPMENT_TEAM="" \
                CODE_SIGN_IDENTITY="" \
                CODE_SIGNING_REQUIRED=NO \
                CODE_SIGNING_ALLOWED=NO \
                ONLY_ACTIVE_ARCH=YES \
                BUILD_DIR="$build_products" \
                CONFIGURATION_BUILD_DIR="$build_products/Debug-iphonesimulator" \
                -quiet >"$xc_log" 2>&1) || xc_exit=$?
            grep -E "Test Suite|passed|failed|error:" "$xc_log" || true
            rm -f "$xc_log"
            if [ $xc_exit -eq 0 ]; then
                ok "xcodebuild test-without-building"
            else
                fail "xcodebuild test-without-building"; all_passed=0
            fi
        fi
    fi

    [ "$all_passed" -eq 1 ] && record "native:ios" "PASS" || record "native:ios" "FAIL"
}

# ── main ──────────────────────────────────────────────────────────────────────
printf "\n${CYAN}test-native.sh — %s${RESET}\n" "$APP_PATH"

[ "$SKIP_SYNC" -eq 0 ] && sync_catalyst_core

# Standalone: setup emulators
if [ "$SKIP_SETUP" -eq 0 ]; then
    header "Setup emulators"
    if should_run "android" && has_script "setupEmulator:android"; then
        printf "  → setupEmulator:android\n"
        setup_log=$(mktemp)
        if (cd "$APP_DIR" && npm run setupEmulator:android >"$setup_log" 2>&1); then
            ok "setupEmulator:android"; rm -f "$setup_log"
        else
            fail "setupEmulator:android"; cat "$setup_log"; rm -f "$setup_log"
            record "native:android" "FAIL"
            ONLY_PLATFORM="ios"
        fi
    fi
    if should_run "ios" && has_script "setupEmulator:ios"; then
        printf "  → setupEmulator:ios\n"
        setup_log=$(mktemp)
        if (cd "$APP_DIR" && npm run setupEmulator:ios >"$setup_log" 2>&1); then
            ok "setupEmulator:ios"; rm -f "$setup_log"
        else
            fail "setupEmulator:ios"; cat "$setup_log"; rm -f "$setup_log"
            record "native:ios" "FAIL"
        fi
    fi
fi

# Standalone: start JS dev server
START_PID=""
if [ "$SKIP_START" -eq 0 ]; then
    header "Start JS dev server"
    server_port=$(get_port "NODE_SERVER_PORT" 3005)
    printf "  → start\n"
    run_server "start" "$server_port" "START_PID" || {
        fail "JS dev server failed — cannot run native tests"
        should_run "android" && record "native:android" "FAIL"
        should_run "ios"     && record "native:ios"     "FAIL"
        exit 1
    }
fi

should_run "android" && run_android || true
should_run "ios"     && run_ios     || true

[ "$SKIP_START" -eq 0 ] && kill_server "${START_PID:-}"

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
