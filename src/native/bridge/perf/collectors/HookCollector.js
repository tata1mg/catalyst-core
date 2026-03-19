/**
 * HookCollector.js — Option A (symptom detection only)
 *
 * Instruments: bugs #13, #15, #16
 *   #13 cart computation loop jank    → LoAF bursts sustained over time, not tied to a single interaction
 *                                       detected as: LoAF count > threshold within a rolling window
 *   #15 quantity selector slow first  → interaction → first LoAF burst → long gap → paint
 *                                       detected as: LoAF fires within LAZY_LOAF_WINDOW_MS after tap
 *   #16 prescription screen touch lag → same pattern as #15
 *
 * Option A strategy (no React hooks needed):
 *   - Watch for LoAF bursts within 2s of a pointerdown (taps that might trigger lazy load)
 *   - If LoAF count > 0 in that window → emit hook/lazy span showing the blocked period
 *   - Sustained LoAF (3+ frames in 5s with no user interaction) → emit hook/mount span
 *     flagging a background computation loop
 *
 * Spans emitted:
 *   catalyst:hook/lazy|<label>    — LoAF burst after interaction (Track: Hook)
 *                                   detail: loafCount, totalBlockingMs, triggerTarget
 *   catalyst:hook/mount|loop      — sustained background LoAF (Track: Hook)
 *                                   detail: loafCount, windowMs, likelyCause='computation-loop'
 *
 * TODO (Option B — future):
 *   Expose window.catalyst.markComponentMount(name) / markComponentReady(name)
 *   for precise hook-lifecycle spans without symptom inference.
 */

import { TRACK, PREFIX, THRESHOLD } from '../core/constants.js'

const LOOP_LOAF_COUNT   = 3     // ≥3 LoAFs in the loop window = computation loop
const LOOP_WINDOW_MS    = 5000  // rolling window to count sustained LoAFs

export class HookCollector {
    constructor(measure) {
        this._measure    = measure

        // Lazy-load detection state
        this._pendingLazy = null  // { startMark, startTime, target, loafCount, totalBlocking, timer }

        // Computation loop detection state
        this._loopLoafs   = []    // [{ start, end }] in rolling LOOP_WINDOW_MS window
    }

    init() {
        // Watch for taps that might trigger lazy component loads
        document.addEventListener('pointerdown', this._onPointerDown.bind(this), { passive: true })
    }

    // Called by RenderCollector via addLoafListener() on every LoAF
    onLoaf(start, end) {
        // ── Lazy-load window ────────────────────────────────────────────────
        if (this._pendingLazy) {
            const p = this._pendingLazy
            p.loafCount++
            p.totalBlocking += (end - start)

            // Reset the close timer — extend window on each LoAF
            clearTimeout(p.timer)
            p.timer = setTimeout(() => this._closeLazySpan(), THRESHOLD.LAZY_LOAF_WINDOW_MS)
        }

        // ── Computation loop detection ───────────────────────────────────────
        const now = performance.now()
        this._loopLoafs.push({ start, end })
        // Evict entries outside the rolling window
        this._loopLoafs = this._loopLoafs.filter((e) => now - e.start < LOOP_WINDOW_MS)

        if (this._loopLoafs.length >= LOOP_LOAF_COUNT) {
            this._emitLoopSpan()
            this._loopLoafs = []  // reset after emitting to avoid duplicate spans
        }
    }

    // ─── Lazy-load span ───────────────────────────────────────────────────────

    _onPointerDown(e) {
        // If a lazy span is already open, let it close naturally
        if (this._pendingLazy) return

        const target    = e.target?.tagName?.toLowerCase() ?? 'unknown'
        const startTime = performance.now()
        const startMark = `${PREFIX.HOOK_LAZY}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })

        const timer = setTimeout(() => this._closeLazySpan(), THRESHOLD.LAZY_LOAF_WINDOW_MS)

        this._pendingLazy = {
            startMark,
            startTime,
            target,
            loafCount:      0,
            totalBlocking:  0,
            timer,
        }
    }

    _closeLazySpan() {
        const p = this._pendingLazy
        if (!p) return
        this._pendingLazy = null
        clearTimeout(p.timer)

        // Only emit if LoAF actually fired — otherwise it was a clean interaction
        if (p.loafCount === 0) return

        const endTime = performance.now()
        this._measure.emit(
            `${PREFIX.HOOK_LAZY}|${p.target}`,
            p.startMark,
            endTime,
            {
                loafCount:      p.loafCount,
                totalBlockingMs: Math.round(p.totalBlocking),
                triggerTarget:  p.target,
                likelyCause:    'lazy-load',
                simulatorValid: false,
            },
            TRACK.HOOK
        )
    }

    // ─── Computation loop span ────────────────────────────────────────────────

    _emitLoopSpan() {
        const first = this._loopLoafs[0]
        const last  = this._loopLoafs[this._loopLoafs.length - 1]
        const markName = `${PREFIX.HOOK_MOUNT}:loop:${Math.round(first.start)}`
        performance.mark(markName, { startTime: first.start })

        const totalBlocking = this._loopLoafs.reduce((sum, e) => sum + (e.end - e.start), 0)

        this._measure.emit(
            `${PREFIX.HOOK_MOUNT}|loop`,
            markName,
            last.end,
            {
                loafCount:       this._loopLoafs.length,
                windowMs:        Math.round(last.end - first.start),
                totalBlockingMs: Math.round(totalBlocking),
                likelyCause:     'computation-loop',
                simulatorValid:  false,
            },
            TRACK.HOOK
        )
    }
}
