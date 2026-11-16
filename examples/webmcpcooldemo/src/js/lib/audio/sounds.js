// Synthesized Web Audio API sound effects (zero external assets/network requests required)
let audioCtx = null

function getAudioContext() {
    if (typeof window === "undefined") return null
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (AudioContext) {
            audioCtx = new AudioContext()
        }
    }
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume()
    }
    return audioCtx
}

export function playClick(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(800, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.04)
        gain.gain.setValueAtTime(0.08, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.04)
    } catch (_) {}
}

export function playPeel(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "triangle"
        osc.frequency.setValueAtTime(320, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(680, ctx.currentTime + 0.12)
        gain.gain.setValueAtTime(0.06, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.12)
    } catch (_) {}
}

export function playBurstSound(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        // Low rumble oscillator
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sawtooth"
        osc.frequency.setValueAtTime(140, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4)
        gain.gain.setValueAtTime(0.18, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.4)
    } catch (_) {}
}

export function playGrandReveal(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const freqs = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5] // C Major sparkle
        freqs.forEach((f, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sine"
            osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.06)
            gain.gain.setValueAtTime(0.09, ctx.currentTime + i * 0.06)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.06 + 0.8)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(ctx.currentTime + i * 0.06)
            osc.stop(ctx.currentTime + i * 0.06 + 0.85)
        })
    } catch (_) {}
}

export function playFootstep(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "triangle"
        const pitch = 220 + Math.random() * 60
        osc.frequency.setValueAtTime(pitch, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.05)
        gain.gain.setValueAtTime(0.04, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.05)
    } catch (_) {}
}

export function playCampfire(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        // Warm crackle pop
        for (let i = 0; i < 3; i++) {
            const delay = i * 0.08 + Math.random() * 0.04
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sawtooth"
            osc.frequency.setValueAtTime(600 + Math.random() * 400, ctx.currentTime + delay)
            osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + delay + 0.04)
            gain.gain.setValueAtTime(0.03, ctx.currentTime + delay)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.04)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(ctx.currentTime + delay)
            osc.stop(ctx.currentTime + delay + 0.05)
        }
    } catch (_) {}
}

export function playPlayfulChimes(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5] // Pentatonic sparkle
        notes.forEach((f, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sine"
            osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.07)
            gain.gain.setValueAtTime(0.07, ctx.currentTime + i * 0.07)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.4)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(ctx.currentTime + i * 0.07)
            osc.stop(ctx.currentTime + i * 0.07 + 0.45)
        })
    } catch (_) {}
}

export function playNpcVoice(enabled = true) {
    if (!enabled) return
    try {
        const ctx = getAudioContext()
        if (!ctx) return
        const tones = [380, 520, 440, 680]
        tones.forEach((freq, idx) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "triangle"
            osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.06)
            gain.gain.setValueAtTime(0.05, ctx.currentTime + idx * 0.06)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.06 + 0.08)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(ctx.currentTime + idx * 0.06)
            osc.stop(ctx.currentTime + idx * 0.06 + 0.09)
        })
    } catch (_) {}
}
