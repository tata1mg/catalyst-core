import React, { useCallback, useEffect, useRef, useState } from "react"
import { useVideoStream } from "catalyst-core/hooks"
import css from "./TryApp.scss"

const COMPANION_PLUGIN_ID = "io.catalyst.companion"
const PREVIEW_COMMAND = "openPreview"
const BRIDGE_PLUGIN_ID = "__bridge__"
const BRIDGE_ERROR_EVENT = "PLUGIN_BRIDGE_ERROR"
const INVALID_URL_MESSAGE =
    "Enter a valid https:// URL (http works for local-network addresses)"
const UNSUPPORTED_SHELL_MESSAGE =
    "Previews require the Catalyst Companion app — this app can't open them."
const RECENTS_STORAGE_KEY = "catalyst-companion.recent-urls"
const MODE_STORAGE_KEY = "catalyst-companion.try-mode"
const SCAN_ACTIVATED_KEY = "catalyst-companion.try-scan-activated"
const MAX_RECENTS = 8

const isNativeShell = () =>
    typeof window !== "undefined" &&
    (!!window.PluginBridge || !!window.webkit?.messageHandlers?.PluginBridge)

const statusFor = (payload) =>
    payload?.code === "INVALID_URL" || payload?.code === "UNSUPPORTED_HOST"
        ? { kind: "field", message: INVALID_URL_MESSAGE }
        : { kind: "error", message: payload?.message || "Failed to open preview" }

const readStorage = (key, fallback) => {
    try {
        return window.localStorage.getItem(key) ?? fallback
    } catch {
        return fallback
    }
}

const writeStorage = (key, value) => {
    try {
        window.localStorage.setItem(key, value)
    } catch {
        return
    }
}

const loadRecents = () => {
    try {
        const parsed = JSON.parse(readStorage(RECENTS_STORAGE_KEY, "[]"))
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []
    } catch {
        return []
    }
}

const normalizeUrl = (raw) => {
    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        const url = new URL(withScheme)
        if (url.protocol === "https:" || url.protocol === "http:") {
            return url.toString()
        }
        return null
    } catch {
        return null
    }
}

function TryApp() {
    const [url, setUrl] = useState("")
    const [recents, setRecents] = useState([])
    const [status, setStatus] = useState(null)
    const [isAwaitingConfirm, setIsAwaitingConfirm] = useState(false)
    const [mode, setMode] = useState("scan")
    const [scanActivated, setScanActivated] = useState(false)

    const bridgeRef = useRef(null)
    const openPreviewRef = useRef(() => {})
    const pendingRef = useRef(false)

    const recordRecent = useCallback((entry) => {
        if (!entry) return
        setRecents((previous) => {
            const next = [entry, ...previous.filter((item) => item !== entry)].slice(0, MAX_RECENTS)
            writeStorage(RECENTS_STORAGE_KEY, JSON.stringify(next))
            return next
        })
    }, [])

    const {
        isStreaming,
        isNative: cameraIsNative,
        error: cameraError,
        start: startCamera,
        stop: stopCamera,
    } = useVideoStream({
        onQRDetected: (data) => {
            const value = typeof data === "string" ? data : data?.value || data?.data
            if (value) {
                stopCamera()
                openPreviewRef.current(value)
            }
        },
    })

    useEffect(() => {
        const storedRecents = loadRecents()
        setRecents(storedRecents)

        const storedMode = readStorage(MODE_STORAGE_KEY, "scan") === "manual" ? "manual" : "scan"
        setScanActivated(readStorage(SCAN_ACTIVATED_KEY, "0") === "1")

        const prefill = new URLSearchParams(window.location.search).get("url")
        const prefilled = Boolean(prefill)
        if (prefill) setUrl(prefill)
        setMode(prefilled ? "manual" : storedMode)

        let cancelled = false
        let cleanup = () => {}
        import("catalyst-core/PluginBridge").then((mod) => {
            if (cancelled) {
                return
            }
            const bridge = typeof mod.default?.emit === "function" ? mod.default : mod.default?.default
            if (!bridge) {
                return
            }
            bridgeRef.current = bridge
            bridge.init()

            const unsubscribeOpened = bridge.register({
                pluginId: COMPANION_PLUGIN_ID,
                eventName: "onPreviewOpened",
                handler: () => {
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus(null)
                },
            })

            const unsubscribeError = bridge.register({
                pluginId: COMPANION_PLUGIN_ID,
                eventName: "onPreviewError",
                handler: (payload) => {
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus(payload?.code === "PREVIEW_CANCELLED" ? null : statusFor(payload))
                },
            })

            const unsubscribeBridgeError = bridge.register({
                pluginId: BRIDGE_PLUGIN_ID,
                eventName: BRIDGE_ERROR_EVENT,
                handler: (payload) => {
                    if (payload?.pluginId !== COMPANION_PLUGIN_ID) {
                        return
                    }
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus({ kind: "info", message: UNSUPPORTED_SHELL_MESSAGE })
                },
            })

            cleanup = () => {
                unsubscribeOpened()
                unsubscribeError()
                unsubscribeBridgeError()
            }
        })
        return () => {
            cancelled = true
            cleanup()
        }
    }, [])

    const requestPreview = useCallback(
        (targetUrl) => {
            if (!isNativeShell()) {
                setStatus({
                    kind: "info",
                    message: "Open this page in Catalyst Companion to preview on a device.",
                })
                return
            }
            const bridge = bridgeRef.current
            if (!bridge) {
                setStatus({ kind: "error", message: "Native bridge is still loading, try again" })
                return
            }
            if (pendingRef.current) return
            try {
                pendingRef.current = true
                recordRecent(targetUrl)
                bridge.emit({
                    pluginId: COMPANION_PLUGIN_ID,
                    command: PREVIEW_COMMAND,
                    data: { url: targetUrl },
                })
                setStatus(null)
                setIsAwaitingConfirm(true)
            } catch (error) {
                pendingRef.current = false
                setIsAwaitingConfirm(false)
                setStatus({ kind: "error", message: error.message })
            }
        },
        [recordRecent]
    )

    const openPreview = useCallback(
        (raw) => {
            const normalized = normalizeUrl(raw)
            if (!normalized) {
                setStatus({ kind: "field", message: INVALID_URL_MESSAGE })
                return
            }
            requestPreview(normalized)
        },
        [requestPreview]
    )
    openPreviewRef.current = openPreview

    const beginScan = useCallback(() => {
        setStatus(null)
        startCamera({ facing: "back", format: "qr" })
    }, [startCamera])

    const showManual = useCallback(() => {
        stopCamera()
        setMode("manual")
        writeStorage(MODE_STORAGE_KEY, "manual")
    }, [stopCamera])

    const showScan = useCallback(() => {
        setMode("scan")
        writeStorage(MODE_STORAGE_KEY, "scan")
    }, [])

    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (mode !== "scan") {
            autoStartedRef.current = false
        }
    }, [mode])

    useEffect(() => {
        if (
            mode === "scan" &&
            scanActivated &&
            cameraIsNative &&
            !cameraError &&
            !autoStartedRef.current
        ) {
            autoStartedRef.current = true
            startCamera({ facing: "back", format: "qr" })
        }
    }, [mode, scanActivated, cameraIsNative, cameraError, startCamera])

    useEffect(() => {
        if (isStreaming && !scanActivated) {
            setScanActivated(true)
            writeStorage(SCAN_ACTIVATED_KEY, "1")
        }
    }, [isStreaming, scanActivated])

    useEffect(() => {
        return () => {
            if (isStreaming) {
                stopCamera()
            }
        }
    }, [isStreaming, stopCamera])

    const banner = status && status.kind !== "field" && (
        <div className={status.kind === "info" ? css.bannerInfo : css.bannerError}>
            {status.message}
        </div>
    )
    const fieldError = status?.kind === "field" ? status.message : null

    return (
        <div className={css.home}>
            <div className={`web-only ${css.card}`}>
                <h2>Try Your Own App</h2>
                <p>
                    Preview any Catalyst app with the full native bridge — scan a QR from your dev
                    server and it runs on the device. This feature is available in the Catalyst
                    Companion app.
                </p>
            </div>

            <section className="shell-only app-screen">
                <header className="app-screen-bar">
                    <span className="app-screen-title">Try Your Own App</span>
                </header>

                {mode === "scan" ? (
                    <>
                        <div className={css.stage}>
                            <div className={css.stagePlaceholder}>
                                    <svg
                                        className={css.stageIcon}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                                        <circle cx="12" cy="12.5" r="3.5" />
                                    </svg>
                                    <p className={css.stageTitle}>
                                        {isAwaitingConfirm ? "Confirm on device…" : "Camera is off"}
                                    </p>
                                    {cameraIsNative ? (
                                        <button
                                            className={css.stageStart}
                                            type="button"
                                            onClick={beginScan}
                                            disabled={isAwaitingConfirm}
                                        >
                                            {isAwaitingConfirm ? "Waiting…" : "Start scanning"}
                                        </button>
                                    ) : (
                                        <p className={css.stageNote}>
                                            Scanning needs the Companion app
                                        </p>
                                    )}
                                </div>
                        </div>

                        <div>
                            {cameraError && (
                                <div className={css.bannerError}>
                                    {cameraError.message || "Camera unavailable"}
                                </div>
                            )}
                            {banner}

                            <p className={css.hint}>
                                Run <code>npm start</code> in your Catalyst app and scan the QR
                                from the terminal.
                            </p>

                            <button className={css.btn} type="button" onClick={showManual}>
                                Enter URL manually
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <button className={css.btn} type="button" onClick={showScan}>
                            Scan a QR instead
                        </button>

                        <p className={css.lede}>
                            Runs your app right here with the full native bridge — its config is
                            fetched from the dev server and applied for the session.
                        </p>

                        {banner}

                        <form
                            onSubmit={(event) => {
                                event.preventDefault()
                                openPreview(url)
                            }}
                        >
                            <div className={css.group}>
                                <input
                                    className={css.urlInput}
                                    type="url"
                                    inputMode="url"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    placeholder="https://your-app.example.com"
                                    aria-label="App URL"
                                    aria-invalid={fieldError ? "true" : undefined}
                                    aria-describedby={fieldError ? "try-url-error" : undefined}
                                    value={url}
                                    onChange={(event) => {
                                        setUrl(event.target.value)
                                        if (status?.kind === "field") setStatus(null)
                                    }}
                                />
                            </div>

                            {fieldError && (
                                <div className={css.bannerError} id="try-url-error" role="alert">
                                    {fieldError}
                                </div>
                            )}

                            <button
                                className={css.btnPrimary}
                                type="submit"
                                disabled={isAwaitingConfirm}
                            >
                                {isAwaitingConfirm ? "Confirm on device…" : "Open Preview"}
                            </button>
                        </form>

                        {recents.length > 0 && (
                            <div className={css.recents}>
                                <h3>Recent</h3>
                                <div className={css.group}>
                                    {recents.map((entry) => (
                                        <button
                                            key={entry}
                                            className={css.recentRow}
                                            type="button"
                                            disabled={isAwaitingConfirm}
                                            onClick={() => openPreview(entry)}
                                        >
                                            <span className={css.recentUrl}>{entry}</span>
                                            <span className={css.recentChevron}>›</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>

            {/*
             * Full-screen while scanning. The native camera renders behind the
             * WebView, so this layer must stay transparent and sit above the
             * bottom nav (z-index 30) — otherwise the tab bar paints over the
             * camera and there is no way out of the scanner.
             */}
            {isStreaming && (
                <div className={css.scanOverlay}>
                    <button
                        className={css.scanClose}
                        type="button"
                        onClick={stopCamera}
                        aria-label="Close scanner"
                    >
                        ✕
                    </button>

                    <div className={css.viewfinder} />

                    <p className={css.scanCaption}>
                        Point at the QR code in your terminal
                    </p>

                    <button className={css.scanCancel} type="button" onClick={stopCamera}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    )
}

export default TryApp
