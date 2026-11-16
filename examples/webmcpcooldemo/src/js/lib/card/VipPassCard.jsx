import React, { useRef, useState, useCallback } from "react"
import css from "./VipPassCard.scss"
import { playClick, playPeel } from "../audio/sounds.js"

// Barcode lines generator for realistic visual aesthetic
const BARCODE_STRIPES = [
    2, 1, 3, 1, 1, 4, 1, 2, 3, 1, 2, 1, 4, 1, 1, 2, 3, 2, 1, 1, 3, 1, 2, 4, 1, 2, 1, 3, 1, 1, 2, 4, 1, 3,
]

export default function VipPassCard({
    word = "COOL!",
    name = "KRONOS",
    archetype = "CYBER MECHA",
    role = "VANGUARD CLASS",
    track = "WebMCP Genesis",
    rarity = "LEGENDARY ✦✦✦✦",
    stats = { atk: 98, def: 86, res: 94 },
    date = "ERA 2027 // GENESIS",
    access = "LEVEL 5 OMNI",
    passNo = "MCH-8821",
    color = "#c6ff3d",
    exploded = false,
    peeled = false,
    overclocked = false,
    knockout = true,
    blend = "multiply",
    showNotes = true,
    sound = true,
    onToggleExplode,
    onTogglePeel,
}) {
    const cardRef = useRef(null)
    const [tilt, setTilt] = useState({ rx: 0, ry: 0 })
    const [isHovering, setIsHovering] = useState(false)

    // Handle 3D perspective mouse tilt
    const handlePointerMove = useCallback((e) => {
        if (exploded || !cardRef.current) return
        const rect = cardRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left - rect.width / 2
        const y = e.clientY - rect.top - rect.height / 2
        const rx = -(y / (rect.height / 2)) * 14
        const ry = (x / (rect.width / 2)) * 14
        setTilt({ rx, ry })
    }, [exploded])

    const handlePointerLeave = useCallback(() => {
        setIsHovering(false)
        setTilt({ rx: 0, ry: 0 })
    }, [])

    const handlePointerEnter = useCallback(() => {
        setIsHovering(true)
    }, [])

    const handlePeelClick = (e) => {
        e.stopPropagation()
        playPeel(sound)
        if (onTogglePeel) onTogglePeel(!peeled)
    }

    const isOverclockActive = peeled || overclocked

    const cardTransform = exploded
        ? undefined
        : `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) ${isHovering ? "scale3d(1.03, 1.03, 1.03)" : ""}`

    return (
        <div
            className={css.cardSceneWrapper}
            data-exploded={exploded}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerEnter={handlePointerEnter}
        >
            <div
                ref={cardRef}
                className={css.sceneContainer}
                data-exploded={exploded}
                data-peeled={peeled}
                style={{ transform: cardTransform }}
            >
                {/* 
                  LAYER 1 (Bottom): <video> / Vibrant Quantum Energy Canvas 
                  Plays underneath everything, emitting rich colored light
                */}
                <div className={`${css.cardLayer} ${css.layerVideo}`} aria-hidden="true">
                    <div
                        className={`${css.liveVideoBg} ${isOverclockActive ? css.overclockedEnergy : ""}`}
                        style={{
                            background: `radial-gradient(circle at 50% 50%, ${color} 0%, #3de0ff 40%, #7b5cff 75%, #000 100%)`,
                        }}
                    />
                </div>

                {/* 
                  LAYER 2: Black Multiply Mask
                  background: #000; mix-blend-mode: multiply;
                  Darkens the video completely to black wherever it covers!
                */}
                <div
                    className={`${css.cardLayer} ${css.layerMultiplyMask}`}
                    style={{ mixBlendMode: knockout ? blend : "normal" }}
                    aria-hidden="true"
                />

                {/* 
                  LAYER 3: Knockout White Text Stencil
                  color: #fff;
                  White has no darkness to add, so the video underneath shines through untouched!
                */}
                <div className={`${css.cardLayer} ${css.layerKnockoutText}`}>
                    <div className={css.knockoutWord}>{word}</div>
                </div>

                {/* 
                  LAYER 4 (Top): The Print & Tactical HUD (Acrylic Relic)
                  Entity name, holographic seal, tactical stats, barcode, and lanyard slot
                */}
                <div className={`${css.cardLayer} ${css.layerPrint}`}>
                    {/* Top Lanyard Slot */}
                    <div className={css.lanyardCutout} />

                    {/* Notches for authentic cyber badge cut */}
                    <div className={css.notchLeft} />
                    <div className={css.notchRight} />

                    {/* Top Header with Rarity Badge */}
                    <div className={css.passHeader}>
                        <div className={css.passHeaderTitle}>
                            <span className={css.rarityBadge}>{rarity}</span>
                        </div>
                        <span className={css.passHeaderDate}>{date}</span>
                    </div>

                    {/* Wireframe background cyber geometry */}
                    <svg viewBox="0 0 300 200" className={css.wireframeGlobe} aria-hidden="true">
                        <circle cx="150" cy="100" r="85" fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="3 3" />
                        <ellipse cx="150" cy="100" rx="125" ry="60" fill="none" stroke="#fff" strokeWidth="1" />
                        <line x1="20" y1="100" x2="280" y2="100" stroke="#fff" strokeWidth="1" strokeDasharray="4 4" />
                        <line x1="150" y1="15" x2="150" y2="185" stroke="#fff" strokeWidth="1" strokeDasharray="4 4" />
                        <polygon points="150,40 210,100 150,160 90,100" fill="none" stroke="#fff" strokeWidth="1" opacity="0.3" />
                    </svg>

                    {/* Center space allowing Layer 3 knockout word to sit in prime visual focus */}
                    <div className={css.knockoutSpace} />

                    {/* Entity Details & Hologram Foil Seal */}
                    <div className={css.attendeeSection}>
                        <div className={css.attendeeDetails}>
                            <div className={css.archetypeTag}>{archetype}</div>
                            <div className={css.attendeeName}>{name}</div>
                            <div className={css.attendeeRoleBadge}>
                                <span className={css.rolePill}>{role}</span>
                                <span className={css.roleSubtitle}>{track}</span>
                            </div>
                        </div>

                        {/* Holographic Security Seal */}
                        <div className={css.holoFoilSeal} title="Quantum Authenticity Seal">
                            <span className={css.holoGlobeIcon} aria-hidden="true">⚡</span>
                        </div>
                    </div>

                    {/* Tactical Power Matrix */}
                    <div className={css.accessMatrix}>
                        <div className={css.matrixCol}>
                            <span className={css.matrixLabel}>ATK</span>
                            <span className={css.matrixVal}>{stats.atk}</span>
                        </div>
                        <div className={css.matrixCol}>
                            <span className={css.matrixLabel}>DEF</span>
                            <span className={css.matrixVal}>{stats.def}</span>
                        </div>
                        <div className={css.matrixCol}>
                            <span className={css.matrixLabel}>RESONANCE</span>
                            <span className={css.matrixVal}>{stats.res}</span>
                        </div>
                    </div>

                    {/* Barcode & Verification Hash */}
                    <div className={css.barcodeWrap}>
                        <svg viewBox="0 0 280 28" className={css.barcodeSvg} preserveAspectRatio="none">
                            {BARCODE_STRIPES.map((w, idx) => {
                                const offset = BARCODE_STRIPES.slice(0, idx).reduce((a, b) => a + b + 3, 6)
                                return <rect key={idx} x={offset} y="0" width={w} height="28" />
                            })}
                        </svg>
                        <div className={css.barcodeMeta}>
                            <span>№ {passNo}</span>
                            <span>{access}</span>
                        </div>
                    </div>

                    {/* Peel-back corner flap */}
                    <div
                        className={css.peelCorner}
                        onClick={handlePeelClick}
                        title={peeled ? "Click to reset protective film" : "Click to peel protective seal (Overclock)"}
                        role="button"
                        tabIndex={0}
                        aria-label="Peel corner toggle"
                    >
                        <div className={css.peelFold}>
                            <div className={css.peelFlap} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Chalk / Handwritten Annotation Callouts (Shown in Exploded View) */}
            {showNotes && exploded && (
                <div className={css.annotationCallouts} aria-hidden="true">
                    {/* Top Callout: Layer 4 HUD Visor */}
                    <div className={`${css.calloutItem} ${css.calloutTopPrint}`}>
                        <span className={css.calloutTag}>Layer 4: HUD &amp; Visor</span>
                        <span className={css.calloutText}>
                            Name, holographic seal, tactical stats &amp; barcode sit on top, not blended
                        </span>
                    </div>

                    {/* Callout: Layer 3 Knockout Text */}
                    <div className={`${css.calloutItem} ${css.calloutKnockoutText}`}>
                        <span className={css.calloutTag}>Layer 3: Knockout Stencil (color: #fff)</span>
                        <span className={css.calloutText}>
                            White has zero darkness to multiply, so the core energy punches through untouched!
                        </span>
                    </div>

                    {/* Callout: Layer 2 Multiply Armor */}
                    <div className={`${css.calloutItem} ${css.calloutMultiplyMask}`}>
                        <span className={css.calloutTag}>Layer 2: Armor Mask (background: #000)</span>
                        <span className={css.calloutText}>
                            Black is as dark as it gets. Combined with mix-blend-mode: multiply, it blackouts everything except the cutout!
                        </span>
                    </div>

                    {/* Callout: Layer 1 Quantum Core */}
                    <div className={`${css.calloutItem} ${css.calloutVideoBase}`}>
                        <span className={css.calloutTag}>Layer 1: Quantum Reactor Core</span>
                        <span className={css.calloutText}>
                            Live WebGL particle engine runs beneath all layers, pulsing radiant color
                        </span>
                    </div>
                </div>
            )}

            {/* Mobile Exploded View Legend */}
            {exploded && (
                <div className={css.mobileExplodedLegend}>
                    <div className={css.legendLayer}>
                        <span className={css.legendDot} style={{ background: "#fff" }} />
                        <div>
                            <strong>HUD Visor (Layer 4):</strong> Name, stats, holographic seal sit on top unblended.
                        </div>
                    </div>
                    <div className={css.legendLayer}>
                        <span className={css.legendDot} style={{ background: "#ffb23d" }} />
                        <div>
                            <strong>Knockout Sigil (Layer 3):</strong> <code>color: #fff</code> lets the inner reactor punch through!
                        </div>
                    </div>
                    <div className={css.legendLayer}>
                        <span className={css.legendDot} style={{ background: "var(--hot)" }} />
                        <div>
                            <strong>Armor Mask (Layer 2):</strong> <code>background: #000; mix-blend-mode: multiply;</code> blocks surrounding area.
                        </div>
                    </div>
                    <div className={css.legendLayer}>
                        <span className={css.legendDot} style={{ background: "var(--cyan)" }} />
                        <div>
                            <strong>Reactor Core (Layer 1):</strong> WebGL energy &amp; particle canvas runs beneath all layers.
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
