import React from "react"
import css from "./TopStoryHud.scss"

export default function TopStoryHud({
    characterName = "PIP",
    archetypeTitle = "THE OVERCLOCKED SLOTH",
    energy = 100, // 0 to 100
    timeOfDay = "day", // "dawn" | "day" | "dusk" | "night"
    timeString = "10:00 AM",
    dayNumber = 1,
    characterMood = "energetic", // "energetic" | "tired" | "playful" | "resting"
    coordinates,
    mode = "interactive", // "interactive" | "auto"
    onToggleMode,
}) {
    // Time badge metadata
    const timeMeta = {
        dawn: { icon: "🌅", label: "Dawn Awakening", color: "#ffb23d" },
        day: { icon: "☀️", label: "Sunny Midday", color: "#c6ff3d" },
        dusk: { icon: "🌇", label: "Twilight Dusk", color: "#ff3ea5" },
        night: { icon: "🌙", label: "Starry Night", color: "#3de0ff" },
    }[timeOfDay] || { icon: "☀️", label: "Sunny Midday", color: "#c6ff3d" }

    // Mood badge metadata
    const moodMeta = {
        energetic: { icon: "⚡", label: "HYPER ACTIVE", color: "#c6ff3d" },
        tired: { icon: "😴", label: "DROWSY & TIRED", color: "#ff3ea5" },
        playful: { icon: "⭐", label: "PLAYFUL & CURIOUS", color: "#3de0ff" },
        resting: { icon: "🔥", label: "RESTING BY FIRE", color: "#ffb23d" },
    }[characterMood] || { icon: "⚡", label: "READY", color: "#c6ff3d" }

    // Energy color gradient calculation
    const energyColor =
        energy > 60 ? "#c6ff3d" : energy > 25 ? "#ffb23d" : "#ff3ea5"

    return (
        <header className={css.topHud} aria-label="Living Story World HUD">
            {/* Left: In-game Date & Day/Night Clock */}
            <div className={css.hudSectionLeft}>
                <div className={css.clockPill} data-time={timeOfDay}>
                    <span className={css.timeIcon} aria-hidden="true">{timeMeta.icon}</span>
                    <div className={css.clockText}>
                        <span className={css.dayDate}>DAY {dayNumber} • {timeString}</span>
                        <span className={css.timeLabel} style={{ color: timeMeta.color }}>
                            {timeMeta.label}
                        </span>
                    </div>
                </div>
            </div>

            {/* Center: Character Name, Title & Mood + 3D Coordinates */}
            <div className={css.hudSectionCenter}>
                <div className={css.characterPill}>
                    <div className={css.avatarDisc} style={{ borderColor: moodMeta.color }}>
                        <span className={css.avatarEmoji}>
                            {characterMood === "tired"
                                ? "(-_-)"
                                : characterMood === "playful"
                                  ? "(★‿★)"
                                  : "(^◡^)"}
                        </span>
                    </div>
                    <div className={css.nameColumn}>
                        <div className={css.nameRow}>
                            <span className={css.charName}>✦ {characterName.toUpperCase()} ✦</span>
                            <span className={css.archetypeTag}>{archetypeTitle}</span>
                        </div>
                        <div className={css.statusSubRow}>
                            <span className={css.moodBadge} style={{ color: moodMeta.color }}>
                                {moodMeta.icon} {moodMeta.label}
                            </span>
                            {coordinates && (
                                <span className={css.coordBadge}>
                                    📍 [{coordinates.x?.toFixed(1) ?? "0.0"}, {coordinates.z?.toFixed(1) ?? "0.0"}]
                                    <span className={css.actionIndicator}>
                                        {coordinates.action === "walk" ? " 🐾 WALK" : " 💤"}
                                    </span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: Energy/Stamina Bar + Mode Switch */}
            <div className={css.hudSectionRight}>
                <div className={css.energyWidget}>
                    <div className={css.energyHeader}>
                        <span className={css.energyLabel}>⚡ STAMINA</span>
                        <span className={css.energyValue} style={{ color: energyColor }}>
                            {Math.round(energy)}%
                        </span>
                    </div>
                    <div className={css.energyTrack}>
                        <div
                            className={css.energyFill}
                            style={{
                                width: `${Math.max(0, Math.min(100, energy))}%`,
                                backgroundColor: energyColor,
                                boxShadow: `0 0 10px ${energyColor}`,
                            }}
                        />
                    </div>
                </div>

                {onToggleMode && (
                    <button
                        className={`${css.modeToggleBtn} ${mode === "auto" ? css.modeAuto : ""}`}
                        onClick={onToggleMode}
                        title="Toggle Auto Director vs Manual Play"
                    >
                        {mode === "auto" ? "▶ AUTO DIRECTOR" : "🎮 INTERACTIVE"}
                    </button>
                )}
            </div>
        </header>
    )
}
