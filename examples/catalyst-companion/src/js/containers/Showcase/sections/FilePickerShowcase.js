import React, { useEffect, useState } from "react"
import { useFilePicker } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import kit from "../../shared/appKit.scss"
import css from "../Showcase.scss"

const MIME_PRESETS = [
    { label: "Any", value: "*/*" },
    { label: "Images", value: "image/*" },
    { label: "PDF", value: "application/pdf" },
]

const formatBytes = (n) => {
    if (!n) return "0 B"
    const units = ["B", "KB", "MB", "GB"]
    let value = n
    let i = 0
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024
        i += 1
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

const extName = (name) => {
    const match = /\.([^.]+)$/.exec(name || "")
    return (match ? match[1] : "file").slice(0, 4).toUpperCase()
}

const FilePickerShowcase = () => {
    const [mimeType, setMimeType] = useState("*/*")
    const [multiple, setMultiple] = useState(true)
    const [error, setError] = useState(null)

    const { data, loading, error: hookError, execute, clear, isNative } = useFilePicker()

    useEffect(() => {
        if (hookError) setError(hookError.message || "File picker error")
    }, [hookError])

    const files = data ? (Array.isArray(data) ? data : [data]) : []

    const pick = () => {
        setError(null)
        const opts = { multiple }
        if (mimeType !== "*/*") opts.mimeType = mimeType
        execute(opts)
    }

    return (
        <>
            <ShowcaseBar title="File Picker" />
            <p className={kit.lede}>
                Opens the native document picker and hands the selection back to the web
                layer — no file input, no browser chrome.
            </p>

            {error && <div className={kit.bannerError}>{error}</div>}
            {!isNative && (
                <div className={kit.bannerInfo}>
                    The native picker needs the Companion app&rsquo;s bridge.
                </div>
            )}

            <div className={kit.group}>
                <div className={kit.row}>
                    <span className={kit.rowLabel}>File type</span>
                    <div className={`${kit.seg} ${kit.rowControl}`}>
                        {MIME_PRESETS.map((preset) => (
                            <button
                                key={preset.value}
                                type="button"
                                className={`${kit.segItem} ${mimeType === preset.value ? kit.segItemOn : ""}`}
                                onClick={() => setMimeType(preset.value)}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>
                <label className={kit.row}>
                    <span className={kit.rowLabel}>
                        Multiple files
                        <small>Allow selecting more than one</small>
                    </span>
                    <input
                        type="checkbox"
                        className={kit.switch}
                        checked={multiple}
                        onChange={(event) => setMultiple(event.target.checked)}
                    />
                </label>
            </div>

            {files.length > 0 && (
                <div className={kit.group}>
                    {files.map((file, index) => {
                        const name = file.fileName || file.name || `file-${index + 1}`
                        return (
                            <div key={`${name}-${index}`} className={css.fileRow}>
                                <span className={css.fileExt}>{extName(name)}</span>
                                <span className={css.fileMain}>
                                    <strong>{name}</strong>
                                    <span>
                                        {file.type || file.mimeType || "unknown"} ·{" "}
                                        {formatBytes(file.fileSize || file.size)}
                                    </span>
                                </span>
                                {file.transport && <span className={css.pill}>{file.transport}</span>}
                            </div>
                        )
                    })}
                </div>
            )}

            <button type="button" className={kit.btnPrimary} onClick={pick} disabled={loading || !isNative}>
                {loading ? "Opening picker…" : "Pick Files"}
            </button>
            {files.length > 0 && (
                <button type="button" className={`${kit.btn} ${kit.btnDanger}`} onClick={clear}>
                    Clear Selection
                </button>
            )}
        </>
    )
}

export default FilePickerShowcase
