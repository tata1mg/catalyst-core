/**
 * constants.js
 *
 * Single source of truth for track names, thresholds, and color rules.
 * All collectors import from here — no magic strings scattered across files.
 */

// ─── Chrome DevTools track group ─────────────────────────────────────────────

export const TRACK_GROUP = 'Catalyst'

export const TRACK = {
    NAVIGATION:   'Navigation',
    SCROLL:       'Scroll',
    INPUT:        'Input',
    KEYBOARD:     'Keyboard',  // alias kept for backward compat — collectors use TRACK.INPUT
    RENDER:       'Render',
    CACHE:        'Cache',
    BRIDGE:       'Bridge',
    HOOK:         'Hook',
    INTERACTION:  'Interaction',
    INSIGHTS:     'Insights',
    NATIVE_API:   'Native API',
}

// ─── Measure name prefixes ────────────────────────────────────────────────────

export const PREFIX = {
    SESSION_NAV:      'catalyst:session/navigation',
    SESSION_SCROLL:   'catalyst:session/scroll',
    SESSION_INPUT:    'catalyst:session/input',
    SESSION_KEYBOARD: 'catalyst:session/keyboard',  // alias — KeyboardCollector still uses this
    LCP:              'catalyst:lcp',
    FCP:              'catalyst:fcp',
    LOAF:             'catalyst:loaf',
    LAYOUT_SHIFT:     'catalyst:layout-shift',
    VIEWPORT_RESIZE:  'catalyst:viewport-resize',
    ROUTE_TRANSITION: 'catalyst:route-transition',
    CACHE:            'catalyst:cache',
    CACHE_GROUP:      'catalyst:cache-group',
    BRIDGE_CALL:      'catalyst:bridge-call',
    HOOK_MOUNT:       'catalyst:hook/mount',
    HOOK_LAZY:        'catalyst:hook/lazy',
    INTERACTION:      'catalyst:interaction',
    SESSION_INTERACTION: 'catalyst:session/interaction',
    LONG_PRESS:       'catalyst:long-press',
    INSIGHT:          'catalyst:insight',
    HW_ACCEL:         'catalyst:hw-accel',
    // Native MetricsMonitor events
    PAGE_LOAD:        'catalyst:page-load',
    COLD_START:       'catalyst:cold-start',
    FPS_DROP:         'catalyst:fps-drop',
    LONG_TASK:        'catalyst:long-task',
    MEMORY_JVM:       'catalyst:mem/jvm',
    MEMORY_NATIVE:    'catalyst:mem/native',
    MEMORY_TOTAL:     'catalyst:mem/total',
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const THRESHOLD = {
    LCP_BAD_MS:           2500,   // LCP > 2.5s = poor (Core Web Vitals)
    NAV_SESSION_BAD_MS:   2500,   // navigation session > 2.5s = slow page
    FETCH_SLOW_MS:        300,    // network fetch > 300ms = slow
    BRIDGE_SLOW_MS:       100,    // bridge round-trip > 100ms = slow
    BRIDGE_TIMEOUT_MS:    3000,   // bridge call with no response = timeout
    SCROLL_IDLE_MS:       150,    // scroll ends after 150ms of no scroll events
    VIEWPORT_MIN_DELTA:   50,     // ignore viewport resize < 50px (not keyboard)
    CACHE_GROUP_IDLE_MS:  300,    // close cache group after 300ms idle
    LOAF_WINDOW:          5,      // keep last N LoAF entries for overlap detection
    LONG_PRESS_MS:        500,    // pointerdown held > 500ms = long press
    INTERACTION_SLOW_MS:  100,    // tap → paint > 100ms = slow response
    LAZY_LOAF_WINDOW_MS:  2000,   // watch for LoAF bursts up to 2s after interaction
    CLS_BAD:              0.1,    // CLS > 0.1 per entry = significant shift
}

// ─── Colors ───────────────────────────────────────────────────────────────────
// Chrome DevTools Extensibility API color values (all 9 values):
//
//   primary / primary-light / primary-dark    → blue tones
//   secondary / secondary-light / secondary-dark → purple/grey tones
//   tertiary / tertiary-light / tertiary-dark → yellow/orange tones
//   error                                     → red
//
// Usage guide:
//   error          = bad outcome (LoAF, miss, slow bridge, memory critical)
//   primary        = cache HIT memory (fastest path)
//   primary-light  = cache HIT disk (good, slightly slower)
//   primary-dark   = good LCP, clean scroll session
//   secondary      = informational (bridge call ok, keyboard, viewport, mem/total normal)
//   primary        = mem/jvm (JVM heap — your Kotlin/Java code)
//   tertiary-dark  = mem/native (V8 + Blink + JNI — WebView proxy; watch for growth)
//   secondary-light = route transition, hook mount (neutral)
//   tertiary       = network fetch after miss (expected but slow)
//   tertiary-light = small CLS, long-press (low signal)
//   tertiary-dark  = insight warning (non-critical)

export const COLOR = {
    ERROR:           'error',
    PRIMARY:         'primary',
    PRIMARY_LIGHT:   'primary-light',
    PRIMARY_DARK:    'primary-dark',
    SECONDARY:       'secondary',
    SECONDARY_LIGHT: 'secondary-light',
    SECONDARY_DARK:  'secondary-dark',
    TERTIARY:        'tertiary',
    TERTIARY_LIGHT:  'tertiary-light',
    TERTIARY_DARK:   'tertiary-dark',
}
