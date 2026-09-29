/** Device safe-area insets in CSS pixels. Every value is non-negative. */
export interface SafeAreaInsets {
    top: number
    right: number
    bottom: number
    left: number
}

export const DEFAULT_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

const coerceNumber = (value: any): number => {
    const numeric = Number(value)
    // Ensure non-negative values
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

const normalizeInsets = (input: any): SafeAreaInsets => {
    if (!input || typeof input !== "object") {
        return { ...DEFAULT_INSETS }
    }

    return {
        top: coerceNumber(input.top),
        right: coerceNumber(input.right),
        bottom: coerceNumber(input.bottom),
        left: coerceNumber(input.left),
    }
}

export const getSafeAreaFromGlobal = (): SafeAreaInsets | null => {
    // Use window on client, globalThis on server (SSR)
    // eslint-disable-next-line no-undef
    const global = typeof window !== "undefined" ? window : globalThis
    const value = global.__SAFE_AREA_INITIAL__

    if (!value) {
        return null
    }

    return normalizeInsets(value)
}

export const setSafeAreaGlobal = (insets: any): SafeAreaInsets => {
    // eslint-disable-next-line no-undef
    const global = typeof window !== "undefined" ? window : globalThis
    const normalized = normalizeInsets(insets)
    global.__SAFE_AREA_INITIAL__ = normalized
    return normalized
}

export const getSafeArea = (): SafeAreaInsets => getSafeAreaFromGlobal() || { ...DEFAULT_INSETS }
