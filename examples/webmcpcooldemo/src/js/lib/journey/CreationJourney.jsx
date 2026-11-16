import React, { useState } from "react"
import VipPassCard from "../card/VipPassCard.jsx"
import { SHAPES, FINISHES } from "../three/OrbScene.js"
import { playClick, playBurstSound, playGrandReveal, playPeel } from "../audio/sounds.js"
import css from "./CreationJourney.scss"

const ARCHETYPES = [
    {
        id: "mecha",
        name: "CYBER MECHA",
        shape: "knot",
        finish: "chrome",
        color: "#c6ff3d",
        spin: 3.5,
        headline: "MECHA-X",
        rarity: "LEGENDARY ✦✦✦✦",
        role: "VANGUARD PROTOCOL",
        stats: { atk: 98, def: 86, res: 92 },
        desc: "Overclocked chrome knot with twin orbital shields.",
    },
    {
        id: "deity",
        name: "CELESTIAL DEITY",
        shape: "crystal",
        finish: "holo",
        color: "#ffb23d",
        spin: 1.2,
        headline: "ASTRAL",
        rarity: "MYTHIC ✦✦✦✦✦",
        role: "COSMIC SOVEREIGN",
        stats: { atk: 92, def: 98, res: 99 },
        desc: "Prismatic crystal prism emitting solar radiance.",
    },
    {
        id: "anomaly",
        name: "QUANTUM ANOMALY",
        shape: "blob",
        finish: "glass",
        color: "#3de0ff",
        spin: 2.0,
        headline: "ANOMALY",
        rarity: "EXOTIC ✦✦✦✦",
        role: "PHASE SHIFTER",
        stats: { atk: 89, def: 94, res: 96 },
        desc: "Translucent shifting fluid plasma core.",
    },
    {
        id: "phantom",
        name: "NEON PHANTOM",
        shape: "torus",
        finish: "wire",
        color: "#ff3ea5",
        spin: 4.8,
        headline: "PHANTOM",
        rarity: "ANOMALOUS ✦✦✦✦✦",
        role: "NETRUNNER ASSASSIN",
        stats: { atk: 99, def: 78, res: 97 },
        desc: "Cyber matrix wireframe gateway.",
    },
]

const PRESET_COLORS = [
    { label: "Acid Lime", value: "#c6ff3d" },
    { label: "Hot Magenta", value: "#ff3ea5" },
    { label: "Electric Cyan", value: "#3de0ff" },
    { label: "Ultra Violet", value: "#7b5cff" },
    { label: "Solar Gold", value: "#ffb23d" },
    { label: "Ghost White", value: "#f4f2ee" },
]

export default function CreationJourney({
    sceneState,
    dimension,
    headline,
    onSetDimension,
    onSetShape,
    onSetColor,
    onSetFinish,
    onSetSpin,
    onBurst,
    onSetHeadline,
    isBursting,
}) {
    const [journeyMode, setJourneyMode] = useState("interactive") // "interactive" | "auto"
    const [activeStep, setActiveStep] = useState(1) // 1 to 4
    const [selectedArchetype, setSelectedArchetype] = useState("mecha")
    const [entityName, setEntityName] = useState("KRONOS-09")
    const [creatorHandle, setCreatorHandle] = useState("Mayank Mahavar")
    const [rarity, setRarity] = useState("LEGENDARY ✦✦✦✦")
    const [stats, setStats] = useState({ atk: 98, def: 86, res: 92 })
    const [serialNo, setSerialNo] = useState("MCH-8821")

    // Reveal State
    const [revealOpen, setRevealOpen] = useState(false)
    const [exploded, setExploded] = useState(false)
    const [peeled, setPeeled] = useState(false)
    const [overclocked, setOverclocked] = useState(false)
    const [soundEnabled, setSoundEnabled] = useState(true)
    const [minted, setMinted] = useState(false)
    const [isAutoSynthesizing, setIsAutoSynthesizing] = useState(false)

    // Apply an Archetype Preset
    const applyArchetype = (arch) => {
        playClick(soundEnabled)
        setSelectedArchetype(arch.id)
        setEntityName(arch.name)
        setRarity(arch.rarity)
        setStats(arch.stats)
        setSerialNo(`${arch.id.slice(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`)

        if (onSetShape) onSetShape(arch.shape)
        if (onSetColor) onSetColor(arch.color)
        if (onSetFinish) onSetFinish(arch.finish)
        if (onSetSpin) onSetSpin(arch.spin)
        if (onSetHeadline) onSetHeadline(arch.headline)
    }

    // Step Navigation in Interactive Mode
    const handleNext = () => {
        playClick(soundEnabled)
        if (activeStep < 4) {
            setActiveStep((s) => s + 1)
        } else {
            handleTriggerReveal()
        }
    }

    const handlePrev = () => {
        playClick(soundEnabled)
        if (activeStep > 1) setActiveStep((s) => s - 1)
    }

    // Trigger the Grand Reveal Climax
    const handleTriggerReveal = () => {
        playBurstSound(soundEnabled)
        if (onBurst) onBurst()
        setTimeout(() => {
            playGrandReveal(soundEnabled)
            setRevealOpen(true)
        }, 320)
    }

    // AI Auto Mode: Autonomous Synthesis
    const runAutoSynthesis = () => {
        playClick(soundEnabled)
        setIsAutoSynthesizing(true)

        // Random roll
        const randomArch = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)]
        const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)].value
        const randomFinish = FINISHES[Math.floor(Math.random() * FINISHES.length)]
        const randomShape = SHAPES[Math.floor(Math.random() * SHAPES.length)]
        const randomSpin = parseFloat((0.8 + Math.random() * 4).toFixed(1))
        const randomWords = ["HYPER-X", "CYBERPUNK", "VORTEX", "NEXUS", "QUANTUM", "OMEGA"]
        const randomWord = randomWords[Math.floor(Math.random() * randomWords.length)]
        const randomSerial = `SYN-${Math.floor(1000 + Math.random() * 9000)}`
        const randomStats = {
            atk: Math.floor(85 + Math.random() * 15),
            def: Math.floor(80 + Math.random() * 20),
            res: Math.floor(90 + Math.random() * 10),
        }

        setSelectedArchetype(randomArch.id)
        setEntityName(`${randomWord} // ${randomArch.name}`)
        setRarity(Math.random() > 0.5 ? "MYTHIC ✦✦✦✦✦" : "LEGENDARY ✦✦✦✦")
        setStats(randomStats)
        setSerialNo(randomSerial)

        // Stage 1: Shape & Dimension
        setTimeout(() => {
            if (onSetShape) onSetShape(randomShape)
            playClick(soundEnabled)
        }, 200)

        // Stage 2: Color & Finish
        setTimeout(() => {
            if (onSetColor) onSetColor(randomColor)
            if (onSetFinish) onSetFinish(randomFinish)
            playClick(soundEnabled)
        }, 500)

        // Stage 3: Spin & Burst
        setTimeout(() => {
            if (onSetSpin) onSetSpin(randomSpin)
            if (onBurst) onBurst()
            playBurstSound(soundEnabled)
        }, 800)

        // Stage 4: Headline
        setTimeout(() => {
            if (onSetHeadline) onSetHeadline(randomWord)
            playClick(soundEnabled)
        }, 1100)

        // Stage 5: Grand Reveal
        setTimeout(() => {
            setIsAutoSynthesizing(false)
            playGrandReveal(soundEnabled)
            setRevealOpen(true)
        }, 1400)
    }

    // Dynamic Overclock
    const handleOverclock = () => {
        playBurstSound(soundEnabled)
        setOverclocked(true)
        if (onBurst) onBurst()
        setTimeout(() => setOverclocked(false), 2400)
    }

    // Reroll Mutation
    const handleRerollMutation = () => {
        playClick(soundEnabled)
        const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)].value
        const randomFinish = FINISHES[Math.floor(Math.random() * FINISHES.length)]
        const randomShape = SHAPES[Math.floor(Math.random() * SHAPES.length)]
        if (onSetColor) onSetColor(randomColor)
        if (onSetFinish) onSetFinish(randomFinish)
        if (onSetShape) onSetShape(randomShape)
        setStats({
            atk: Math.min(100, stats.atk + Math.floor(Math.random() * 5) - 2),
            def: Math.min(100, stats.def + Math.floor(Math.random() * 5) - 2),
            res: Math.min(100, stats.res + Math.floor(Math.random() * 5) - 2),
        })
        if (onBurst) onBurst()
    }

    const handleMint = () => {
        playClick(soundEnabled)
        setMinted(true)
        setTimeout(() => setMinted(false), 3000)
    }

    return (
        <>
            <div className={css.journeyBar} role="region" aria-label="Creation Journey">
                <div className={css.journeyTopRow}>
                    <div className={css.journeyHeader}>
                        <div className={css.journeySparkle} aria-hidden="true">
                            ✦
                        </div>
                        <div className={css.journeyTitleGroup}>
                            <h3 className={css.journeyTitle}>Genesis Forge — Cyber Character &amp; Artifact Quest</h3>
                            <span className={css.journeySubtitle}>Choose manual decisions or let AI Auto Mode synthesize a unique entity</span>
                        </div>
                    </div>

                    {/* Mode Selector */}
                    <div className={css.modeToggleGroup} role="group" aria-label="Journey Mode Switcher">
                        <button
                            className={`${css.modeToggleBtn} ${journeyMode === "interactive" ? css.modeToggleActive : ""}`}
                            onClick={() => { playClick(soundEnabled); setJourneyMode("interactive") }}
                        >
                            <span>🎮 Manual Choice</span>
                        </button>
                        <button
                            className={`${css.modeToggleBtn} ${journeyMode === "auto" ? css.modeToggleActive : ""}`}
                            onClick={() => { playClick(soundEnabled); setJourneyMode("auto") }}
                        >
                            <span>⚡ AI Auto Mode</span>
                        </button>
                    </div>

                    {/* Stage Indicator (when in manual choice mode) */}
                    {journeyMode === "interactive" && (
                        <div className={css.stepIndicator}>
                            {[1, 2, 3, 4].map((stepNum) => (
                                <span
                                    key={stepNum}
                                    className={css.stepPill}
                                    data-active={activeStep === stepNum}
                                    data-complete={activeStep > stepNum}
                                    onClick={() => { playClick(soundEnabled); setActiveStep(stepNum) }}
                                    style={{ cursor: "pointer" }}
                                >
                                    Stage {stepNum}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* AI AUTO MODE BANNER */}
                {journeyMode === "auto" ? (
                    <div className={css.autoPilotCard}>
                        <div className={css.autoPilotStatus}>
                            <div className={css.autoPilotPulse} />
                            <div>
                                <strong style={{ color: "#fff", fontSize: 13 }}>Autonomous Agent Synthesis Mode</strong>
                                <p style={{ color: "var(--fg-dim)", fontSize: 11, margin: "2px 0 0 0" }}>
                                    WebMCP Agent composes geometry, shaders, kinetic resonance, and rolls RPG stats in real-time.
                                </p>
                            </div>
                        </div>
                        <button
                            className={css.autoPilotBtn}
                            onClick={runAutoSynthesis}
                            disabled={isAutoSynthesizing}
                        >
                            {isAutoSynthesizing ? "Synthesizing Entity… ⚡" : "🎲 Synthesize Unique Hero Now!"}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* MANUAL CHOICE MODE: Agent Guide Prompt Box */}
                        <div className={css.journeyPromptBox}>
                            <div className={css.agentAvatar}>AI</div>
                            <div className={css.agentPromptText}>
                                {activeStep === 1 && (
                                    <span>
                                        <strong>Stage 1 of 4:</strong> Select an Archetype Core (Mecha, Deity, Anomaly, Phantom) or sculpt custom geometry in 3D/2D.
                                    </span>
                                )}
                                {activeStep === 2 && (
                                    <span>
                                        <strong>Stage 2 of 4:</strong> Infuse physical material surface finish (Holo, Chrome, Glass, Wire) and radiant spectral chromadynamics.
                                    </span>
                                )}
                                {activeStep === 3 && (
                                    <span>
                                        <strong>Stage 3 of 4:</strong> Set angular velocity resonance and test the quantum particle shockwave discharge.
                                    </span>
                                )}
                                {activeStep === 4 && (
                                    <span>
                                        <strong>Stage 4 of 4:</strong> Inscribe the Knockout Punch-Out Sigil and forge your Entity &amp; Creator identity.
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Stage 1: Archetypes Grid & Custom Geometry */}
                        {activeStep === 1 && (
                            <div>
                                <div className={css.archetypeGrid}>
                                    {ARCHETYPES.map((arch) => (
                                        <div
                                            key={arch.id}
                                            className={css.archetypeCard}
                                            data-selected={selectedArchetype === arch.id}
                                            onClick={() => applyArchetype(arch)}
                                        >
                                            <div className={css.archetypeHeader}>
                                                <span className={css.archetypeName}>{arch.name}</span>
                                                <span className={css.archetypeBadge}>{arch.rarity.split(" ")[0]}</span>
                                            </div>
                                            <span className={css.archetypeDesc}>{arch.desc}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className={css.optionsGroup} style={{ marginTop: 6 }}>
                                    <button
                                        className={css.choiceBtn}
                                        data-selected={dimension === "3d"}
                                        onClick={() => { playClick(soundEnabled); onSetDimension("3d") }}
                                    >
                                        🌐 3D WebGL
                                    </button>
                                    <button
                                        className={css.choiceBtn}
                                        data-selected={dimension === "2d"}
                                        onClick={() => { playClick(soundEnabled); onSetDimension("2d") }}
                                    >
                                        🎨 2D Stencil
                                    </button>
                                    {SHAPES.map((s) => (
                                        <button
                                            key={s}
                                            className={css.choiceBtn}
                                            data-selected={sceneState.shape === s}
                                            onClick={() => { playClick(soundEnabled); onSetShape(s) }}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Stage 2: Chromatics & Surface Finish */}
                        {activeStep === 2 && (
                            <div className={css.optionsGroup}>
                                {FINISHES.map((f) => (
                                    <button
                                        key={f}
                                        className={css.choiceBtn}
                                        data-selected={sceneState.finish === f}
                                        onClick={() => { playClick(soundEnabled); onSetFinish(f) }}
                                    >
                                        {f}
                                    </button>
                                ))}
                                {PRESET_COLORS.map((c) => (
                                    <button
                                        key={c.value}
                                        className={css.choiceBtn}
                                        data-selected={sceneState.color === c.value}
                                        onClick={() => { playClick(soundEnabled); onSetColor(c.value) }}
                                        style={{ borderColor: c.value }}
                                    >
                                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.value }} />
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Stage 3: Kinetics & Shockwave Burst */}
                        {activeStep === 3 && (
                            <div className={css.optionsGroup}>
                                {[0.5, 1.5, 3.0, 4.5].map((spd) => (
                                    <button
                                        key={spd}
                                        className={css.choiceBtn}
                                        data-selected={sceneState.spin === spd}
                                        onClick={() => { playClick(soundEnabled); onSetSpin(spd) }}
                                    >
                                        Spin {spd}x
                                    </button>
                                ))}
                                <button
                                    className={css.choiceBtn}
                                    onClick={() => { playBurstSound(soundEnabled); onBurst() }}
                                    style={{ background: "rgb(198 255 61 / 0.15)", borderColor: "var(--acid)", color: "var(--acid)" }}
                                >
                                    ⚡ Test Shockwave Burst
                                </button>
                            </div>
                        )}

                        {/* Stage 4: Sigil & Identity Inscription */}
                        {activeStep === 4 && (
                            <div className={css.optionsGroup}>
                                {["MECHA-X", "ASTRAL", "ANOMALY", "PHANTOM", "COOL!", "CATALYST"].map((w) => (
                                    <button
                                        key={w}
                                        className={css.choiceBtn}
                                        data-selected={headline === w}
                                        onClick={() => { playClick(soundEnabled); onSetHeadline(w) }}
                                    >
                                        Sigil: {w}
                                    </button>
                                ))}
                                <input
                                    type="text"
                                    value={entityName}
                                    onChange={(e) => setEntityName(e.target.value)}
                                    placeholder="Entity Name"
                                    style={{
                                        height: 34,
                                        borderRadius: 10,
                                        background: "rgb(255 255 255 / 0.08)",
                                        border: "1px solid var(--line)",
                                        color: "#fff",
                                        padding: "0 10px",
                                        fontSize: 12,
                                        fontFamily: "var(--font-sans)",
                                    }}
                                />
                                <input
                                    type="text"
                                    value={creatorHandle}
                                    onChange={(e) => setCreatorHandle(e.target.value)}
                                    placeholder="Creator Handle"
                                    style={{
                                        height: 34,
                                        borderRadius: 10,
                                        background: "rgb(255 255 255 / 0.08)",
                                        border: "1px solid var(--line)",
                                        color: "#fff",
                                        padding: "0 10px",
                                        fontSize: 12,
                                        fontFamily: "var(--font-sans)",
                                    }}
                                />
                            </div>
                        )}

                        {/* Bottom Navigation Buttons */}
                        <div className={css.stepActionRow}>
                            <button
                                className={css.prevBtn}
                                onClick={handlePrev}
                                disabled={activeStep === 1}
                            >
                                ← Back
                            </button>
                            {activeStep < 4 ? (
                                <button className={css.nextBtn} onClick={handleNext}>
                                    Next Stage →
                                </button>
                            ) : (
                                <button className={css.revealTriggerBtn} onClick={handleTriggerReveal}>
                                    ✨ The Grand Reveal!
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* GRAND REVEAL CLIMAX MODAL */}
            {revealOpen && (
                <div className={css.revealModalOverlay} role="dialog" aria-modal="true" aria-label="Grand Reveal Relic">
                    <button
                        id="close-reveal-modal"
                        className={css.closeRevealBtn}
                        onClick={() => setRevealOpen(false)}
                        aria-label="Close Grand Reveal"
                    >
                        ✕
                    </button>

                    <div className={css.revealHeader}>
                        <div className={css.revealBadge}>
                            <span>Holographic Cyber Relic • 1-of-1 Minted</span>
                        </div>
                        <h2 className={css.revealTitle}>The Grand Reveal</h2>
                        <p className={css.revealSubtitle}>
                            Your creation has crystallized into a 3D Holographic Artifact Card with interactive seal peel &amp; 3D layer explosion!
                        </p>
                    </div>

                    {/* The 3D Cyber Relic Card */}
                    <VipPassCard
                        word={headline || "COOL!"}
                        name={entityName}
                        archetype={selectedArchetype.toUpperCase()}
                        role="VANGUARD ENTITY"
                        track={creatorHandle}
                        rarity={rarity}
                        stats={stats}
                        passNo={serialNo}
                        color={sceneState.color}
                        exploded={exploded}
                        peeled={peeled}
                        overclocked={overclocked}
                        knockout={true}
                        blend="multiply"
                        showNotes={true}
                        sound={soundEnabled}
                        onToggleExplode={setExploded}
                        onTogglePeel={setPeeled}
                    />

                    {/* Interactive Climax Controls */}
                    <div className={css.revealControlsRow}>
                        <button
                            className={css.revealBtn}
                            data-active={exploded}
                            onClick={() => {
                                playClick(soundEnabled)
                                setExploded((e) => !e)
                            }}
                        >
                            <span>{exploded ? "🗂️ Collapse Anatomy" : "💥 Explode 3D Anatomy"}</span>
                        </button>

                        <button
                            className={css.revealBtn}
                            data-active={peeled}
                            onClick={() => {
                                playPeel(soundEnabled)
                                setPeeled((p) => !p)
                            }}
                        >
                            <span>{peeled ? "↩️ Reset Seal" : "🏷️ Peel Protective Film"}</span>
                        </button>

                        <button
                            className={css.revealBtn}
                            onClick={handleOverclock}
                            title="Overclock core energy with particle shockwave"
                        >
                            <span>⚡ Overclock Core</span>
                        </button>

                        <button
                            className={css.revealBtn}
                            onClick={handleRerollMutation}
                            title="Reroll random mutation on this entity"
                        >
                            <span>🎲 Mutate Stats</span>
                        </button>

                        <button
                            className={css.revealBtn}
                            onClick={handleMint}
                        >
                            <span>{minted ? "✓ Relic Minted!" : "🎖️ Mint Digital Relic"}</span>
                        </button>

                        <button
                            className={css.revealBtn}
                            data-active={soundEnabled}
                            onClick={() => setSoundEnabled((s) => !s)}
                            title="Toggle Web Audio sound effects"
                        >
                            <span>{soundEnabled ? "🔊 Sound On" : "🔇 Sound Off"}</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
