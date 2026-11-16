import React, { useState } from "react"
import { useTool } from "catalyst-core/webmcp"
import { BLENDS, BACKDROPS } from "@lib/agent/planner.js"
import { useIsFiring } from "@lib/webmcp/wire.js"
import css from "./BlendLab.scss"

const INITIAL_STICKERS = [
    { id: "s1", text: "KNOCKOUT", blend: "multiply", x: 22, y: 28, rotate: -6 },
    { id: "s2", text: "WEBMCP ACTIVE", blend: "difference", x: 55, y: 45, rotate: 4 },
    { id: "s3", text: "NO SCREEN SCRAPING", blend: "multiply", x: 18, y: 68, rotate: 2 },
    { id: "s4", text: "CSS BLEND MAGIC", blend: "screen", x: 62, y: 72, rotate: -3 },
]

export default function BlendLab() {
    const [stickers, setStickers] = useState(INITIAL_STICKERS)
    const [backdrop, setBackdrop] = useState("aurora")
    const [newText, setNewText] = useState("AGENT DISCOVERED")
    const [newBlend, setNewBlend] = useState("multiply")

    // --- WebMCP Tools Registration (Route-Scoped to /stickers) ---
    useTool({
        name: "add_sticker",
        description:
            "Slap an interactive CSS mix-blend-mode knockout sticker onto the canvas. " +
            "Supports blends: multiply (knockout), screen, difference, exclusion, overlay, color-dodge.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text content for the sticker (e.g. 'HELLO AGENT')" },
                blend: {
                    type: "string",
                    enum: BLENDS,
                    description: "CSS mix-blend-mode (defaults to 'multiply' for knockout text)",
                },
                rotate: { type: "number", description: "Rotation angle in degrees (-20 to 20)" },
            },
            required: ["text"],
        },
        execute: async ({ text, blend = "multiply", rotate }) => {
            const rot = rotate !== undefined ? rotate : Math.floor(Math.random() * 16) - 8
            const id = `s_${Date.now().toString(36)}`
            const next = {
                id,
                text: String(text).toUpperCase(),
                blend: BLENDS.includes(blend) ? blend : "multiply",
                x: 15 + Math.floor(Math.random() * 60),
                y: 15 + Math.floor(Math.random() * 60),
                rotate: rot,
            }
            setStickers((prev) => [...prev, next])
            return {
                id,
                added: true,
                sticker: next,
                total: stickers.length + 1,
                note: `Placed "${next.text}" with ${next.blend} blend mode`,
            }
        },
    })

    useTool({
        name: "clear_stickers",
        description: "Clear all placed stickers from the blend laboratory wall.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            const count = stickers.length
            setStickers([])
            return { cleared: true, removedCount: count }
        },
    })

    useTool({
        name: "set_backdrop",
        description: `Change the vibrant background canvas gradient preset. Presets: ${BACKDROPS.join(", ")}.`,
        inputSchema: {
            type: "object",
            properties: {
                preset: {
                    type: "string",
                    enum: BACKDROPS,
                    description: "Gradient preset backdrop name",
                },
            },
            required: ["preset"],
        },
        execute: async ({ preset }) => {
            if (!BACKDROPS.includes(preset)) {
                throw new Error(`Invalid preset "${preset}". Available: ${BACKDROPS.join(", ")}`)
            }
            setBackdrop(preset)
            return { backdrop: preset, ok: true }
        },
    })

    useTool({
        name: "list_stickers",
        description: "Read all current active stickers, their text labels, blend modes, and coordinates.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => ({
            backdrop,
            stickersCount: stickers.length,
            stickers,
        }),
    })

    // Glowing activity triggers
    const isAdding = useIsFiring("add_sticker")
    const isClearing = useIsFiring("clear_stickers")
    const isBackdropFiring = useIsFiring("set_backdrop")

    const handleCreateSubmit = (e) => {
        e.preventDefault()
        if (!newText.trim()) return
        const rot = Math.floor(Math.random() * 16) - 8
        const id = `s_${Date.now().toString(36)}`
        setStickers((prev) => [
            ...prev,
            {
                id,
                text: newText.trim().toUpperCase(),
                blend: newBlend,
                x: 20 + Math.floor(Math.random() * 50),
                y: 20 + Math.floor(Math.random() * 50),
                rotate: rot,
            },
        ])
    }

    const removeSticker = (id) => {
        setStickers((prev) => prev.filter((s) => s.id !== id))
    }

    return (
        <div className={css.lab}>
            {/* Main Stage & Canvas */}
            <div className={css.canvasArea}>
                <div className={`${css.backdrop} ${css[`bg_${backdrop}`]}`} data-backdrop={backdrop}>
                    {/* Atmospheric animation overlay */}
                    <div className={css.ambientGlow} />

                    {/* Interactive Stickers Layer */}
                    <div className={css.stickerField}>
                        {stickers.map((s) => (
                            <div
                                key={s.id}
                                className={`${css.sticker} ${css[`blend_${s.blend}`]}`}
                                style={{
                                    left: `${s.x}%`,
                                    top: `${s.y}%`,
                                    transform: `translate(-50%, -50%) rotate(${s.rotate}deg)`,
                                }}
                            >
                                <span className={css.stickerText}>{s.text}</span>
                                <span className={css.stickerMeta}>{s.blend}</span>
                                <button
                                    className={css.stickerDismiss}
                                    onClick={() => removeSticker(s.id)}
                                    title="Remove sticker"
                                    aria-label="Remove sticker"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Educational Knockout Callout Banner */}
                    <div className={css.explainBox}>
                        <div className={css.explainHead}>
                            <span className="chip" data-tone="acid">mix-blend-mode: multiply</span>
                            <span className={css.tag}>Knockout Text Recipe</span>
                        </div>
                        <pre className={css.codeSnippet}>
{`.sticker {
  background: #000;
  color: #fff;
  mix-blend-mode: multiply;
}`}
                        </pre>
                        <p className={css.explainText}>
                            White pixels (<code>#fff</code>) multiply by background color to become <strong>transparent</strong>,
                            letting the vibrant backdrop bleed through as letterforms!
                        </p>
                    </div>
                </div>
            </div>

            {/* Sidebar Controls */}
            <aside className={css.labDeck}>
                <div className={css.deckTop}>
                    <h2>Blend Laboratory</h2>
                    <span className="chip" data-tone="hot">
                        <span className="dot" />
                        {stickers.length} Stickers Active
                    </span>
                </div>

                {/* Preset Backdrops */}
                <div className={`${css.group} ${isBackdropFiring ? css.groupFiring : ""}`}>
                    <div className={css.groupHeader}>
                        <label className={css.label}>Canvas Backdrop (set_backdrop)</label>
                        {isBackdropFiring && <span className={css.pulse}>Agent Invoking…</span>}
                    </div>
                    <div className={css.backdropGrid}>
                        {BACKDROPS.map((b) => (
                            <button
                                key={b}
                                className={`${css.bgBtn} ${backdrop === b ? css.bgActive : ""}`}
                                onClick={() => setBackdrop(b)}
                            >
                                <span className={`${css.bgSwatch} ${css[`thumb_${b}`]}`} />
                                <span className="mono">{b}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Add Sticker Form */}
                <div className={`${css.group} ${isAdding ? css.groupFiring : ""}`}>
                    <div className={css.groupHeader}>
                        <label className={css.label}>Create Sticker (add_sticker)</label>
                        {isAdding && <span className={css.pulse}>Agent Invoking…</span>}
                    </div>
                    <form className={css.createForm} onSubmit={handleCreateSubmit}>
                        <input
                            type="text"
                            className={css.formInput}
                            value={newText}
                            onChange={(e) => setNewText(e.target.value)}
                            placeholder="Sticker text…"
                            maxLength={32}
                        />

                        <div className={css.blendSelectRow}>
                            <label className={css.subLabel}>Blend Mode:</label>
                            <select
                                className={css.select}
                                value={newBlend}
                                onChange={(e) => setNewBlend(e.target.value)}
                            >
                                {BLENDS.map((mode) => (
                                    <option key={mode} value={mode}>
                                        {mode} {mode === "multiply" ? "(Knockout)" : ""}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={css.formActions}>
                            <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                                Slap Sticker 👋
                            </button>
                        </div>
                    </form>
                </div>

                {/* Action Buttons */}
                <div className={`${css.group} ${isClearing ? css.groupFiring : ""}`}>
                    <div className={css.groupHeader}>
                        <label className={css.label}>Danger Zone (clear_stickers)</label>
                        {isClearing && <span className={css.pulse}>Agent Clearing…</span>}
                    </div>
                    <button
                        className={`btn btn-ghost ${css.clearBtn}`}
                        onClick={() => setStickers([])}
                        disabled={stickers.length === 0}
                    >
                        Wipe All Stickers 🗑️
                    </button>
                </div>
            </aside>
        </div>
    )
}

BlendLab.setMetaData = () => [
    <title key="title">CSS mix-blend-mode Knockout Lab — WebMCP</title>,
    <meta
        key="desc"
        name="description"
        content="Experiment with CSS mix-blend-mode knockout typography, stencil stickers, and agent-controlled dynamic blends."
    />,
]
