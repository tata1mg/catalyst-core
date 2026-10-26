import React, { useEffect, useRef, useState } from "react"
import { NavLink } from "react-router"
import { useTool } from "catalyst-core/webmcp"
import { SHAPES, FINISHES, createOrbScene } from "@lib/three/OrbScene.js"
import { useIsFiring } from "@lib/webmcp/wire.js"
import CreationJourney from "@lib/journey/CreationJourney.jsx"
import css from "./Home.scss"


const PRESET_COLORS = [
    { label: "Acid Lime", value: "#c6ff3d" },
    { label: "Hot Magenta", value: "#ff3ea5" },
    { label: "Electric Cyan", value: "#3de0ff" },
    { label: "Ultra Violet", value: "#7b5cff" },
    { label: "Solar Gold", value: "#ffb23d" },
    { label: "Ghost White", value: "#f4f2ee" },
]

// eslint-disable-next-line react/prop-types
function FlatCanvas({ shape = "knot", color = "#c6ff3d", spin = 1, finish = "holo" }) {
    const rotSpeed = spin > 0 ? (14 / Math.max(spin, 0.3)) : 0
    const animStyle = rotSpeed ? { animation: `${css.spinFlat} ${rotSpeed}s linear infinite` } : {}

    return (
        <div className={css.flatCanvasStage}>
            {/* Grid & Halftone matrix */}
            <div className={css.flatGrid} />

            <div className={css.flatGraphicWrap} style={animStyle}>
                <svg viewBox="0 0 400 400" className={css.flatSvg}>
                    <defs>
                        <linearGradient id="grad2d" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={color} />
                            <stop offset="100%" stopColor="#7b5cff" />
                        </linearGradient>
                        <radialGradient id="rad2d" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                            <stop offset="70%" stopColor={color} stopOpacity="0.3" />
                            <stop offset="100%" stopColor="transparent" />
                        </radialGradient>
                    </defs>

                    {/* Concentric orbital rings */}
                    <circle cx="200" cy="200" r="160" stroke={color} strokeWidth="1" strokeDasharray="4 8" fill="none" opacity="0.35" />
                    <circle cx="200" cy="200" r="130" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.2" />
                    <circle cx="200" cy="200" r="185" stroke={color} strokeWidth="2" strokeDasharray="2 12" fill="none" opacity="0.5" />

                    {/* Shapes */}
                    {shape === "knot" && (
                        <g>
                            <path
                                d="M 120,200 C 120,130 180,130 200,200 C 220,270 280,270 280,200 C 280,130 220,130 200,200 C 180,270 120,270 120,200 Z"
                                fill="none"
                                stroke="url(#grad2d)"
                                strokeWidth="32"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <circle cx="120" cy="200" r="10" fill="#fff" />
                            <circle cx="280" cy="200" r="10" fill="#fff" />
                        </g>
                    )}

                    {shape === "torus" && (
                        <g>
                            <ellipse cx="200" cy="200" rx="110" ry="70" fill="none" stroke="url(#grad2d)" strokeWidth="30" />
                            <ellipse cx="200" cy="200" rx="140" ry="90" fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 6" opacity="0.7" />
                        </g>
                    )}

                    {shape === "cube" && (
                        <g>
                            <polygon points="200,90 290,140 200,195 110,140" fill={color} opacity="0.85" />
                            <polygon points="110,140 200,195 200,300 110,245" fill={color} opacity="0.5" />
                            <polygon points="290,140 200,195 200,300 290,245" fill="#7b5cff" opacity="0.9" />
                        </g>
                    )}

                    {shape === "crystal" && (
                        <g>
                            <polygon points="200,70 300,200 200,330 100,200" fill="url(#grad2d)" opacity="0.8" />
                            <line x1="100" y1="200" x2="300" y2="200" stroke="#fff" strokeWidth="2" opacity="0.6" />
                            <line x1="200" y1="70" x2="200" y2="330" stroke="#fff" strokeWidth="2" opacity="0.6" />
                        </g>
                    )}

                    {shape === "blob" && (
                        <path
                            d="M 200,95 C 280,105 320,160 305,225 C 290,290 230,320 175,305 C 115,290 85,235 95,175 C 105,115 145,85 200,95 Z"
                            fill="url(#rad2d)"
                            stroke={color}
                            strokeWidth="5"
                        />
                    )}

                    {shape === "orb" && (
                        <g>
                            <circle cx="200" cy="200" r="95" fill="url(#rad2d)" />
                            <circle cx="200" cy="200" r="95" stroke={color} strokeWidth="3" fill="none" />
                            <line x1="60" y1="200" x2="340" y2="200" stroke={color} strokeWidth="2" strokeDasharray="4 4" opacity="0.7" />
                        </g>
                    )}
                </svg>

                {/* Stencil Knockout badge in center */}
                <div className={css.flatKnockoutBadge}>
                    <span className={css.flatStickerTag}>
                        2D VECTOR • {shape.toUpperCase()} • {finish.toUpperCase()}
                    </span>
                </div>
            </div>
        </div>
    )
}

export default function Home() {
    const canvasHostRef = useRef(null)
    const sceneRef = useRef(null)

    const [dimension, setDimension] = useState("3d") // "3d" | "2d"
    const [sceneState, setSceneState] = useState({
        shape: "knot",
        color: "#c6ff3d",
        finish: "holo",
        spin: 1.2,
    })
    const [headline, setHeadline] = useState("CYBER•SCULPT")
    const [copiedPrompt, setCopiedPrompt] = useState(false)

    // Mount 3D Scene in browser
    useEffect(() => {
        if (!canvasHostRef.current) return
        const scene = createOrbScene(canvasHostRef.current, {
            shape: sceneState.shape,
            color: sceneState.color,
            finish: sceneState.finish,
            spin: sceneState.spin,
        })
        sceneRef.current = scene

        return () => {
            if (scene) scene.dispose()
            sceneRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // --- WebMCP Tools Registration (Route-Scoped) ---
    useTool({
        name: "sculpt_shape",
        description: `Morph the geometry in real-time. Available shapes: ${SHAPES.join(", ")}.`,
        inputSchema: {
            type: "object",
            properties: {
                shape: {
                    type: "string",
                    enum: SHAPES,
                    description: "Target geometry shape name",
                },
            },
            required: ["shape"],
        },
        execute: async ({ shape }) => {
            if (!SHAPES.includes(shape)) {
                throw new Error(`Invalid shape "${shape}". Choose one of: ${SHAPES.join(", ")}`)
            }
            if (sceneRef.current) sceneRef.current.setShape(shape)
            setSceneState((s) => ({ ...s, shape }))
            return { shape, ok: true, note: `Morphed geometry to ${shape}` }
        },
    })

    useTool({
        name: "paint",
        description: "Repaint the sculpture and lighting. Accepts any hex color code (e.g. #c6ff3d, #ff3ea5, #3de0ff).",
        inputSchema: {
            type: "object",
            properties: {
                color: {
                    type: "string",
                    description: "Hex color code string",
                },
            },
            required: ["color"],
        },
        execute: async ({ color }) => {
            if (sceneRef.current) sceneRef.current.setColor(color)
            setSceneState((s) => ({ ...s, color }))
            return { color, ok: true, note: `Sculpture color updated to ${color}` }
        },
    })

    useTool({
        name: "set_finish",
        description: `Set physical surface material finish: ${FINISHES.join(", ")}.`,
        inputSchema: {
            type: "object",
            properties: {
                finish: {
                    type: "string",
                    enum: FINISHES,
                    description: "Physical material preset name",
                },
            },
            required: ["finish"],
        },
        execute: async ({ finish }) => {
            if (!FINISHES.includes(finish)) {
                throw new Error(`Invalid finish "${finish}". Available: ${FINISHES.join(", ")}`)
            }
            if (sceneRef.current) sceneRef.current.setFinish(finish)
            setSceneState((s) => ({ ...s, finish }))
            return { finish, ok: true }
        },
    })

    useTool({
        name: "set_spin",
        description: "Adjust rotation angular velocity (0 for frozen, up to 6 for turbo).",
        inputSchema: {
            type: "object",
            properties: {
                speed: {
                    type: "number",
                    minimum: 0,
                    description: "Rotation speed multiplier (0 to 6)",
                },
            },
            required: ["speed"],
        },
        execute: async ({ speed }) => {
            if (sceneRef.current) sceneRef.current.setSpin(speed)
            setSceneState((s) => ({ ...s, spin: speed }))
            return { speed, ok: true }
        },
    })

    useTool({
        name: "burst",
        description: "Trigger a kinetic quantum particle burst explosion with elastic spring recovery.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            if (sceneRef.current) sceneRef.current.burst()
            return { exploded: true, particles: 1500, note: "Quantum particle shockwave triggered" }
        },
    })

    useTool({
        name: "set_headline",
        description: "Update the giant hero knockout typography text across the canvas.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Bold headline text (max 24 chars)" },
            },
            required: ["text"],
        },
        execute: async ({ text }) => {
            const trimmed = String(text || "").trim().slice(0, 24).toUpperCase()
            setHeadline(trimmed)
            return { headline: trimmed, ok: true }
        },
    })

    useTool({
        name: "set_dimension",
        description: "Toggle between 3D WebGL sculpture mode and 2D kinetic flat stencil mode. Mode can be '3d' or '2d'.",
        inputSchema: {
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    enum: ["3d", "2d"],
                    description: "Visual dimension mode: '3d' or '2d'",
                },
            },
            required: ["mode"],
        },
        execute: async ({ mode }) => {
            if (mode !== "3d" && mode !== "2d") {
                throw new Error(`Invalid mode "${mode}". Must be "3d" or "2d".`)
            }
            setDimension(mode)
            return { dimension: mode, ok: true, note: `Switched view to ${mode.toUpperCase()} mode` }
        },
    })

    useTool({
        name: "toggle_dimension",
        description: "Toggle between 3D WebGL and 2D flat kinetic graphic renderers.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            const next = dimension === "3d" ? "2d" : "3d"
            setDimension(next)
            return { dimension: next, ok: true, note: `Toggled to ${next.toUpperCase()} mode` }
        },
    })

    useTool({
        name: "apply_archetype",
        description: "Apply a legendary cyber entity archetype template ('mecha', 'deity', 'anomaly', 'phantom') with coordinated geometry, finish, color, and kinetic resonance.",
        inputSchema: {
            type: "object",
            properties: {
                archetype: {
                    type: "string",
                    enum: ["mecha", "deity", "anomaly", "phantom"],
                    description: "Target entity archetype preset",
                },
            },
            required: ["archetype"],
        },
        execute: async ({ archetype }) => {
            const presets = {
                mecha: { shape: "knot", finish: "chrome", color: "#c6ff3d", spin: 3.5, headline: "MECHA-X" },
                deity: { shape: "crystal", finish: "holo", color: "#ffb23d", spin: 1.2, headline: "ASTRAL" },
                anomaly: { shape: "blob", finish: "glass", color: "#3de0ff", spin: 2.0, headline: "ANOMALY" },
                phantom: { shape: "torus", finish: "wire", color: "#ff3ea5", spin: 4.8, headline: "PHANTOM" },
            }
            const p = presets[archetype] || presets.mecha
            if (sceneRef.current) {
                sceneRef.current.setShape(p.shape)
                sceneRef.current.setColor(p.color)
                sceneRef.current.setFinish(p.finish)
                sceneRef.current.setSpin(p.spin)
                sceneRef.current.burst()
            }
            setSceneState({ shape: p.shape, color: p.color, finish: p.finish, spin: p.spin })
            setHeadline(p.headline)
            return {
                archetype,
                applied: true,
                entity: p,
                note: `Synthesized ${archetype.toUpperCase()} entity profile`,
            }
        },
    })

    useTool({
        name: "auto_synthesize_entity",
        description: "Autonomous AI mode: Procedurally roll a wild unique cyber entity, generate RPG stats, trigger shockwave burst, and unveil the Grand Reveal.",
        inputSchema: {
            type: "object",
            properties: {
                theme: { type: "string", description: "Optional aesthetic mood or prompt (e.g. 'solar warrior', 'cyber gladiator')" },
            },
        },
        execute: async ({ theme }) => {
            const shapes = ["crystal", "knot", "torus", "blob", "cube", "orb"]
            const finishes = ["chrome", "holo", "glass", "wire"]
            const colors = ["#c6ff3d", "#ff3ea5", "#3de0ff", "#ffb23d", "#7b5cff"]
            const randomShape = shapes[Math.floor(Math.random() * shapes.length)]
            const randomFinish = finishes[Math.floor(Math.random() * finishes.length)]
            const randomColor = colors[Math.floor(Math.random() * colors.length)]
            const randomSpin = parseFloat((1.5 + Math.random() * 3.5).toFixed(1))
            const randomHeadline = ["HYPER-X", "CYBERPUNK", "NEXUS", "KRONOS", "QUANTUM"][Math.floor(Math.random() * 5)]

            if (sceneRef.current) {
                sceneRef.current.setShape(randomShape)
                sceneRef.current.setColor(randomColor)
                sceneRef.current.setFinish(randomFinish)
                sceneRef.current.setSpin(randomSpin)
                sceneRef.current.burst()
            }
            setSceneState({ shape: randomShape, color: randomColor, finish: randomFinish, spin: randomSpin })
            setHeadline(randomHeadline)

            return {
                synthesized: true,
                theme: theme || "autonomous",
                shape: randomShape,
                finish: randomFinish,
                color: randomColor,
                spin: randomSpin,
                headline: randomHeadline,
                rarity: "MYTHIC ✦✦✦✦✦",
                note: "Autonomous AI synthesis complete! Entity forged and revealed.",
            }
        },
    })

    useTool({
        name: "start_journey",
        description: "Launch the interactive 4-stage co-creation journey (sculpt -> chromadynamics -> kinetics -> identity -> grand reveal).",
        inputSchema: {
            type: "object",
            properties: {
                theme: { type: "string", description: "Creation theme archetype (e.g. 'cyberpunk', 'holographic', 'solarpunk')" },
            },
        },
        execute: async ({ theme }) => {
            return {
                started: true,
                stage: 1,
                totalStages: 4,
                theme: theme || "holographic",
                note: "Genesis co-creation journey activated! Proceed through stages to reach the Grand Reveal.",
            }
        },
    })

    useTool({
        name: "trigger_grand_reveal",
        description: "Trigger the cinematic Grand Reveal climax: shockwave particles, celestial sound chime, and 3D Holographic VIP Pass with peel corner & exploded view.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            if (sceneRef.current) sceneRef.current.burst()
            return {
                revealed: true,
                ok: true,
                note: "The Grand Reveal climax triggered! 3D VIP Pass unlocked.",
            }
        },
    })


    useTool({
        name: "get_scene",
        description: "Read the current sculpture state including shape, color, finish, spin speed, headline, and 3D/2D dimension.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => ({
            dimension,
            ...sceneState,
            headline,
            toolsRegisteredOnRoute: [
                "sculpt_shape",
                "paint",
                "set_finish",
                "set_spin",
                "burst",
                "set_headline",
                "set_dimension",
                "toggle_dimension",
                "start_journey",
                "apply_archetype",
                "auto_synthesize_entity",
                "trigger_grand_reveal",
                "get_scene",
            ],

        }),
    })


    // Glowing activity hooks
    const isSculpting = useIsFiring("sculpt_shape")
    const isPainting = useIsFiring("paint")
    const isFinishing = useIsFiring("set_finish")
    const isSpinning = useIsFiring("set_spin")
    const isBursting = useIsFiring("burst")
    const isTitling = useIsFiring("set_headline")
    const isTogglingDim = useIsFiring("set_dimension") || useIsFiring("toggle_dimension")

    const handleShapeClick = (shape) => {
        if (sceneRef.current) sceneRef.current.setShape(shape)
        setSceneState((s) => ({ ...s, shape }))
    }

    const handleColorClick = (color) => {
        if (sceneRef.current) sceneRef.current.setColor(color)
        setSceneState((s) => ({ ...s, color }))
    }

    const handleFinishClick = (finish) => {
        if (sceneRef.current) sceneRef.current.setFinish(finish)
        setSceneState((s) => ({ ...s, finish }))
    }

    const handleBurstClick = () => {
        if (sceneRef.current) sceneRef.current.burst()
    }

    const handleCopyDemoPrompt = () => {
        const prompt = 'Make it a neon pink chrome knot spinning fast and burst!'
        if (navigator.clipboard) {
            navigator.clipboard.writeText(prompt)
            setCopiedPrompt(true)
            setTimeout(() => setCopiedPrompt(false), 2000)
        }
    }

    return (
        <div className={css.studio}>
            {/* Viewport: Either 3D WebGL or 2D Vector Flat Canvas */}
            {dimension === "3d" ? (
                <div className={css.canvasStage} ref={canvasHostRef}>
                    <div className={css.dragHint}>
                        <span>Drag to rotate</span>
                    </div>
                </div>
            ) : (
                <FlatCanvas
                    shape={sceneState.shape}
                    color={sceneState.color}
                    spin={sceneState.spin}
                    finish={sceneState.finish}
                />
            )}

            {/* Giant Knockout Background Headline */}
            <div className={css.backdropTitleWrap} aria-hidden="true">
                <h1 className={`${css.backdropTitle} ${isTitling ? css.firingGlow : ""}`}>
                    {headline}
                </h1>
            </div>

            {/* Hero Overlay Info */}
            <div className={css.heroBanner}>
                <div className={css.badgeRow}>
                    <span className="chip" data-tone="acid">
                        <span className="dot" />
                        WebMCP {dimension.toUpperCase()} Viewport
                    </span>
                    <span className="chip" data-tone="cyan">
                        Route Scoped
                    </span>
                    <span className="chip">
                        {dimension === "3d" ? "Three.js + Shaders" : "Kinetic SVG Stencils"}
                    </span>
                </div>

                {/* Promo link to dedicated Living Quest route */}
                <NavLink to="/journey" className={css.questCalloutBanner} viewTransition>
                    <span className={css.questPill}>NEW 3D ROUTE</span>
                    <span>
                        <strong>Living Quest</strong> — Walk Pip in 3D, Day/Night cycles &amp; Monolith relic
                    </span>
                    <span className={css.questArrow}>Enter Quest →</span>
                </NavLink>

                <h2 className={css.heroHeading}>
                    Browser AI agents invoke WebMCP tools to manipulate live {dimension.toUpperCase()} web graphics.
                </h2>

                <p className={css.heroDesc}>
                    This scene registers 9 imperative WebMCP tools via Catalyst&apos;s useTool(). An AI agent calls tools directly on document.modelContext to sculpt, paint, animate, or toggle between 3D and 2D.
                </p>

                <div className={css.heroActions}>
                    <button
                        className={`btn btn-primary ${css.actionBtn}`}
                        onClick={handleCopyDemoPrompt}
                    >
                        <span>{copiedPrompt ? "Copied Prompt! ✓" : "Copy Agent Prompt 📋"}</span>
                    </button>
                    <button
                        className={`btn btn-ghost ${css.actionBtn}`}
                        onClick={handleBurstClick}
                    >
                        Trigger Shockwave ⚡
                    </button>
                </div>

                <div style={{ pointerEvents: "auto", marginTop: 14 }}>
                    <CreationJourney
                        sceneState={sceneState}
                        dimension={dimension}
                        headline={headline}
                        onSetDimension={(dim) => setDimension(dim)}
                        onSetShape={(shp) => handleShapeClick(shp)}
                        onSetColor={(col) => handleColorClick(col)}
                        onSetFinish={(fin) => handleFinishClick(fin)}
                        onSetSpin={(spd) => {
                            if (sceneRef.current) sceneRef.current.setSpin(spd)
                            setSceneState((s) => ({ ...s, spin: spd }))
                        }}
                        onBurst={handleBurstClick}
                        onSetHeadline={(txt) => setHeadline(txt)}
                        isBursting={isBursting}
                    />
                </div>
            </div>


            {/* Live Interactive Control Deck */}
            <aside className={css.controlDeck} aria-label="Studio Controls">
                <div className={css.deckHeader}>
                    <div className={css.deckTitle}>
                        <h3>Interactive Studio Deck</h3>
                        <span className={css.deckSub}>Direct UI or Agent WebMCP Tool Calls</span>
                    </div>
                    <div className={css.activeStatus}>
                        <span className={css.activeDot} style={{ backgroundColor: sceneState.color }} />
                        <span className="mono">
                            {dimension.toUpperCase()} • {sceneState.shape}
                        </span>
                    </div>
                </div>

                {/* 3D vs 2D Dimension Switcher */}
                <div className={`${css.deckSection} ${isTogglingDim ? css.sectionFiring : ""}`}>
                    <div className={css.sectionLabelRow}>
                        <label className={css.sectionLabel}>Dimension Renderer (set_dimension)</label>
                        {isTogglingDim && <span className={css.toolPulse}>Agent Toggling…</span>}
                    </div>
                    <div className={css.dimToggleRow}>
                        <button
                            className={`${css.dimOption} ${dimension === "3d" ? css.dimOptionActive : ""}`}
                            onClick={() => setDimension("3d")}
                        >
                            🌐 3D WebGL Sculpture
                        </button>
                        <button
                            className={`${css.dimOption} ${dimension === "2d" ? css.dimOptionActive : ""}`}
                            onClick={() => setDimension("2d")}
                        >
                            🎨 2D Kinetic Stencil
                        </button>
                    </div>
                </div>

                {/* Geometry Morphing */}
                <div className={`${css.deckSection} ${isSculpting ? css.sectionFiring : ""}`}>
                    <div className={css.sectionLabelRow}>
                        <label className={css.sectionLabel}>Geometry (sculpt_shape)</label>
                        {isSculpting && <span className={css.toolPulse}>Agent Invoking…</span>}
                    </div>
                    <div className={css.pillGroup}>
                        {SHAPES.map((shp) => (
                            <button
                                key={shp}
                                className={`${css.pill} ${sceneState.shape === shp ? css.pillActive : ""}`}
                                onClick={() => handleShapeClick(shp)}
                            >
                                {shp}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Surface Finish */}
                <div className={`${css.deckSection} ${isFinishing ? css.sectionFiring : ""}`}>
                    <div className={css.sectionLabelRow}>
                        <label className={css.sectionLabel}>Material Finish (set_finish)</label>
                        {isFinishing && <span className={css.toolPulse}>Agent Invoking…</span>}
                    </div>
                    <div className={css.pillGroup}>
                        {FINISHES.map((fin) => (
                            <button
                                key={fin}
                                className={`${css.pill} ${sceneState.finish === fin ? css.pillActive : ""}`}
                                onClick={() => handleFinishClick(fin)}
                            >
                                {fin}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Color Palette */}
                <div className={`${css.deckSection} ${isPainting ? css.sectionFiring : ""}`}>
                    <div className={css.sectionLabelRow}>
                        <label className={css.sectionLabel}>Color Spectrum (paint)</label>
                        {isPainting && <span className={css.toolPulse}>Agent Invoking…</span>}
                    </div>
                    <div className={css.swatchGroup}>
                        {PRESET_COLORS.map((c) => (
                            <button
                                key={c.value}
                                className={`${css.swatch} ${sceneState.color === c.value ? css.swatchActive : ""}`}
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                                onClick={() => handleColorClick(c.value)}
                            />
                        ))}
                    </div>
                </div>

                {/* Kinetics and Shockwave */}
                <div className={`${css.deckSection} ${isSpinning || isBursting ? css.sectionFiring : ""}`}>
                    <div className={css.sectionLabelRow}>
                        <label className={css.sectionLabel}>Kinetics (set_spin, burst)</label>
                        {(isSpinning || isBursting) && <span className={css.toolPulse}>Agent Invoking…</span>}
                    </div>
                    <div className={css.sliderRow}>
                        <span className="mono">Spin: {sceneState.spin.toFixed(1)}x</span>
                        <input
                            type="range"
                            min="0"
                            max="5"
                            step="0.2"
                            value={sceneState.spin}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value)
                                if (sceneRef.current) sceneRef.current.setSpin(val)
                                setSceneState((s) => ({ ...s, spin: val }))
                            }}
                            className={css.rangeInput}
                        />
                        <button className={`${css.burstBtn} ${isBursting ? css.burstActive : ""}`} onClick={handleBurstClick}>
                            Shockwave Burst 💥
                        </button>
                    </div>
                </div>
            </aside>
        </div>
    )
}

Home.setMetaData = () => [
    <title key="title">WebMCP Studio — 3D &amp; 2D Graphics Driven by AI Agents</title>,
    <meta
        key="desc"
        name="description"
        content="An immersive 3D and 2D WebMCP showcase application where AI agents sculpt, color, animate, and toggle dimensions in real-time."
    />,
]
