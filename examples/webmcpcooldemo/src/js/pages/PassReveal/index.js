import React, { useState } from "react"
import { useTool } from "catalyst-core/webmcp"
import VipPassCard from "@lib/card/VipPassCard.jsx"
import { playClick, playPeel, playGrandReveal } from "@lib/audio/sounds.js"
import { useIsFiring } from "@lib/webmcp/wire.js"
import css from "./PassReveal.scss"

const COLOR_MAP = {
    club: "#ff3ea5",
    aurora: "#3de0ff",
    solar: "#ffb23d",
    acid: "#c6ff3d",
}

export default function PassReveal() {
    const [knockout, setKnockout] = useState(true)
    const [peel, setPeel] = useState(false)
    const [explode, setExplode] = useState(false)
    const [tilt, setTilt] = useState(true)
    const [tiltAmount, setTiltAmount] = useState(2.0)
    const [word, setWord] = useState("cool!")
    const [name, setName] = useState("Jhey Tompkins")
    const [videoTheme, setVideoTheme] = useState("club")
    const [blend, setBlend] = useState("multiply")
    const [notes, setNotes] = useState(true)
    const [sound, setSound] = useState(true)

    // Route-scoped WebMCP tools on /pass
    useTool({
        name: "toggle_exploded_view",
        description: "Split the VIP card into 4 isometric 3D floating layers with educational handwritten chalk callouts, or collapse them back.",
        inputSchema: {
            type: "object",
            properties: {
                exploded: { type: "boolean", description: "true to explode layers, false to collapse" },
            },
        },
        execute: async ({ exploded }) => {
            const next = exploded !== undefined ? exploded : !explode
            setExplode(next)
            playClick(sound)
            return {
                exploded: next,
                ok: true,
                note: next ? "Card exploded into 4 3D isometric layers with chalk notes" : "Card collapsed back to solid badge",
            }
        },
    })

    useTool({
        name: "toggle_peel",
        description: "Peel back the top-right corner of the blackout sticker to reveal the radiant video/canvas underneath.",
        inputSchema: {
            type: "object",
            properties: {
                peeled: { type: "boolean", description: "true to peel corner, false to stick down" },
            },
        },
        execute: async ({ peeled }) => {
            const next = peeled !== undefined ? peeled : !peel
            setPeel(next)
            playPeel(sound)
            return {
                peeled: next,
                ok: true,
                note: next ? "Corner peeled back with golden foil underside" : "Corner pressed back flat",
            }
        },
    })

    useTool({
        name: "set_pass_word",
        description: "Change the central knockout typography word (e.g. 'cool!', 'init', 'WEBMCP', 'CATALYST').",
        inputSchema: {
            type: "object",
            properties: {
                word: { type: "string", description: "Knockout text string" },
            },
            required: ["word"],
        },
        execute: async ({ word: newWord }) => {
            setWord(newWord)
            playClick(sound)
            return { word: newWord, ok: true }
        },
    })

    useTool({
        name: "set_pass_name",
        description: "Update the attendee name printed onto the VIP pass.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Attendee full name" },
            },
            required: ["name"],
        },
        execute: async ({ name: newName }) => {
            setName(newName)
            playClick(sound)
            return { name: newName, ok: true }
        },
    })

    useTool({
        name: "set_pass_theme",
        description: "Change the video lighting theme underneath the card (club, aurora, solar, acid).",
        inputSchema: {
            type: "object",
            properties: {
                theme: { type: "string", enum: ["club", "aurora", "solar", "acid"], description: "Color theme" },
            },
            required: ["theme"],
        },
        execute: async ({ theme }) => {
            if (COLOR_MAP[theme]) {
                setVideoTheme(theme)
                playClick(sound)
                return { theme, ok: true }
            }
            throw new Error(`Invalid theme "${theme}". Options: club, aurora, solar, acid`)
        },
    })

    useTool({
        name: "get_pass_state",
        description: "Read the complete current configuration of the 3D Knockout Video Card and its layers.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => ({
            knockout,
            peel,
            explode,
            tilt,
            tiltAmount,
            word,
            name,
            videoTheme,
            blend,
            notes,
            sound,
        }),
    })

    const isExplodingFiring = useIsFiring("toggle_exploded_view")
    const isPeelingFiring = useIsFiring("toggle_peel")
    const isWordFiring = useIsFiring("set_pass_word")

    const handleWordSelect = (presetWord) => {
        playClick(sound)
        setWord(presetWord)
    }

    return (
        <div className={css.passPage}>
            <div className={css.blueprintGrid} />

            <header className={css.passStageHeader}>
                <div className={css.stageChip}>
                    <span>Interactive Knockout Video Card</span>
                </div>
                <h1 className={css.stageHeading}>The Knockout Pass &amp; Exploded Layer View</h1>
                <p className={css.stageSub}>
                    Demonstrating CSS <code>mix-blend-mode: multiply</code> knockout typography with 3D peel &amp; exploded layer architecture.
                </p>
            </header>

            <div className={css.stageWorkspace}>
                {/* 3D Card Stage */}
                <div className={css.cardStageArea}>
                    <VipPassCard
                        word={word}
                        name={name}
                        role="SPEAKER"
                        track="Main stage"
                        date="14-15 MAY 2027"
                        color={COLOR_MAP[videoTheme] || "#ff3ea5"}
                        exploded={explode}
                        peeled={peel}
                        knockout={knockout}
                        blend={blend}
                        showNotes={notes}
                        sound={sound}
                        onToggleExplode={(val) => {
                            playClick(sound)
                            setExplode(val)
                        }}
                        onTogglePeel={(val) => {
                            playPeel(sound)
                            setPeel(val)
                        }}
                    />
                </div>

                {/* Floating Config Panel matching user's screen recording reference */}
                <aside className={css.configPanel} aria-label="Pass Configuration">
                    <div className={css.configPanelHeader}>
                        <span>config</span>
                        <span>⚙</span>
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>knockout</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={knockout}
                            onChange={(e) => { playClick(sound); setKnockout(e.target.checked) }}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>peel</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={peel}
                            onChange={(e) => { playPeel(sound); setPeel(e.target.checked) }}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>explode</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={explode}
                            onChange={(e) => { playClick(sound); setExplode(e.target.checked) }}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>tilt</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={tilt}
                            onChange={(e) => setTilt(e.target.checked)}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>tilt amount</span>
                        <input
                            type="range"
                            min="0.5"
                            max="5.0"
                            step="0.5"
                            className={css.configSlider}
                            value={tiltAmount}
                            onChange={(e) => setTiltAmount(parseFloat(e.target.value))}
                        />
                        <span style={{ fontSize: 10, color: "var(--fg-dim)", width: 28 }}>{tiltAmount.toFixed(2)}</span>
                    </div>

                    <div className={css.configSectionDivider} />

                    <div className={css.configRow}>
                        <span className={css.configLabel}>word</span>
                        <input
                            type="text"
                            className={css.configInput}
                            value={word}
                            onChange={(e) => setWord(e.target.value)}
                        />
                    </div>

                    <div className={css.quickPresetsRow}>
                        {["cool!", "init", "CATALYST", "WEBMCP"].map((w) => (
                            <button
                                key={w}
                                className={css.quickPresetBtn}
                                onClick={() => handleWordSelect(w)}
                            >
                                {w}
                            </button>
                        ))}
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>name</span>
                        <input
                            type="text"
                            className={css.configInput}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>video</span>
                        <select
                            className={css.configSelect}
                            value={videoTheme}
                            onChange={(e) => { playClick(sound); setVideoTheme(e.target.value) }}
                        >
                            <option value="club">club (pink/violet)</option>
                            <option value="aurora">aurora (cyan)</option>
                            <option value="solar">solar (gold)</option>
                            <option value="acid">acid (lime)</option>
                        </select>
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>blend</span>
                        <select
                            className={css.configSelect}
                            value={blend}
                            onChange={(e) => { playClick(sound); setBlend(e.target.value) }}
                        >
                            <option value="multiply">multiply (knockout)</option>
                            <option value="screen">screen</option>
                            <option value="difference">difference</option>
                        </select>
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>notes</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={notes}
                            onChange={(e) => setNotes(e.target.checked)}
                        />
                    </div>

                    <div className={css.configRow}>
                        <span className={css.configLabel}>sound</span>
                        <input
                            type="checkbox"
                            className={css.configCheckbox}
                            checked={sound}
                            onChange={(e) => setSound(e.target.checked)}
                        />
                    </div>
                </aside>
            </div>
        </div>
    )
}

PassReveal.setMetaData = () => [
    <title key="title">Knockout Video Card — 3D Exploded Layer View &amp; Reveal</title>,
    <meta
        key="desc"
        name="description"
        content="Interactive knockout video conference pass with peel corner, exploded 3D layers, and CSS mix-blend-mode typography."
    />,
]
