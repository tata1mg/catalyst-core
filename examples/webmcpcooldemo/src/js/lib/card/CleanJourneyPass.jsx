import React, { useRef, useState, useCallback } from "react"
import { playClick } from "../audio/sounds.js"
import css from "./CleanJourneyPass.scss"

export default function CleanJourneyPass({
    characterName = "PIP",
    archetypeTitle = "THE OVERCLOCKED SLOTH",
    characterColor = "#c6ff3d",
    milestones = [
        { id: "start", label: "Awakened at Frontier Base", icon: "🏕️", completed: true },
        { id: "fire", label: "Campfire Ignited & Rested", icon: "🔥", completed: true },
        { id: "sage", label: "Elder Byte Guidance Received", icon: "🧭", completed: true },
        { id: "berries", label: "Quantum Energy Berries Harvested", icon: "🍇", completed: true },
        { id: "monolith", label: "Ancient Monolith Cosmic Resonance", icon: "🏛️", completed: true },
        { id: "chest", label: "Starlight Relic Chest Opened", icon: "✨", completed: true },
    ],
    stats = {
        stamina: "100%",
        distance: "18.4m",
        atmosphere: "Starry Night 🌙",
        tier: "MYTHIC S-RANK ✦✦✦✦✦",
    },
    serialNo = "EXP-9021",
    onClose,
}) {
    const cardRef = useRef(null)
    const [tilt, setTilt] = useState({ rx: 0, ry: 0 })
    const [copied, setCopied] = useState(false)

    // Interactive 3D perspective mouse tilt
    const handlePointerMove = useCallback((e) => {
        if (!cardRef.current) return
        const rect = cardRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left - rect.width / 2
        const y = e.clientY - rect.top - rect.height / 2
        const rx = -(y / (rect.height / 2)) * 12
        const ry = (x / (rect.width / 2)) * 12
        setTilt({ rx, ry })
    }, [])

    const handlePointerLeave = useCallback(() => {
        setTilt({ rx: 0, ry: 0 })
    }, [])

    const handleCopy = () => {
        playClick(true)
        const summary = `✦ LIVING QUEST CHRONICLE // ${characterName} ✦\nArchetype: ${archetypeTitle}\nTier: ${stats.tier}\nStamina: ${stats.stamina} | Explored: ${stats.distance} in 3D\nCompleted Milestones: ${milestones.filter((m) => m.completed).map((m) => m.label).join(", ")}\nWebMCP Serial: #${serialNo}`
        navigator.clipboard?.writeText(summary)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div
            className={css.cardWrapper}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            <div
                ref={cardRef}
                className={css.passCard}
                style={{
                    transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
                    borderColor: characterColor,
                }}
            >
                {/* Holographic Iridescent Sheen */}
                <div className={css.holoSheen} aria-hidden="true" />

                {/* Card Header */}
                <div className={css.cardHeader}>
                    <div className={css.headerTag}>
                        <span className={css.tagDot} style={{ background: characterColor }} />
                        <span>WEBMCP QUEST CHRONICLE</span>
                    </div>
                    <span className={css.serialTag}>#{serialNo}</span>
                </div>

                {/* Hero Character Profile */}
                <div className={css.heroProfile}>
                    <div
                        className={css.avatarDisc}
                        style={{ borderColor: characterColor, boxShadow: `0 0 20px ${characterColor}55` }}
                    >
                        <span className={css.avatarEmoji}>(★‿★)</span>
                    </div>
                    <div className={css.heroText}>
                        <h3 className={css.charName} style={{ color: characterColor }}>
                            {characterName.toUpperCase()}
                        </h3>
                        <p className={css.charTitle}>{archetypeTitle}</p>
                    </div>
                    <div className={css.tierBadge}>
                        <span>{stats.tier}</span>
                    </div>
                </div>

                {/* Meaningful Adventure Milestones */}
                <div className={css.milestonesSection}>
                    <div className={css.sectionHeading}>
                        <span>JOURNEY MILESTONES</span>
                        <span className={css.countBadge}>
                            {milestones.filter((m) => m.completed).length}/{milestones.length} COMPLETED
                        </span>
                    </div>
                    <div className={css.milestoneGrid}>
                        {milestones.map((m) => (
                            <div
                                key={m.id}
                                className={`${css.milestoneItem} ${m.completed ? css.milestoneDone : ""}`}
                            >
                                <span className={css.itemIcon}>{m.icon}</span>
                                <span className={css.itemLabel}>{m.label}</span>
                                <span className={css.checkMark}>{m.completed ? "✓" : "○"}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Clean Stats Triad */}
                <div className={css.statsTriad}>
                    <div className={css.statBox}>
                        <span className={css.statLabel}>STAMINA</span>
                        <span className={css.statValue} style={{ color: characterColor }}>
                            {stats.stamina}
                        </span>
                    </div>
                    <div className={css.statBox}>
                        <span className={css.statLabel}>3D DISTANCE</span>
                        <span className={css.statValue}>{stats.distance}</span>
                    </div>
                    <div className={css.statBox}>
                        <span className={css.statLabel}>SKY ATMOSPHERE</span>
                        <span className={css.statValue}>{stats.atmosphere}</span>
                    </div>
                </div>

                {/* Card Action Buttons */}
                <div className={css.cardActions}>
                    <button className={css.copyBtn} onClick={handleCopy}>
                        {copied ? "Copied Chronicle! ✓" : "Copy Quest Summary 📋"}
                    </button>
                    {onClose && (
                        <button className={css.closeBtn} onClick={onClose}>
                            Close &amp; Keep Exploring ✕
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
