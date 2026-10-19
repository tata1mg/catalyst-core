import React, { useEffect, useRef, useState, useCallback } from "react"
import { invokeTool } from "catalyst-core/webmcp"
import { createStoryWorldScene, WAYPOINTS } from "@lib/three/StoryWorldScene.js"
import LivingJourney from "@lib/journey/LivingJourney.jsx"
import { playClick } from "@lib/audio/sounds.js"
import css from "./Journey.scss"

export default function Journey() {
    const canvasHostRef = useRef(null)
    const sceneRef = useRef(null)

    const [characterColor, setCharacterColor] = useState("#c6ff3d")
    const [coordinates, setCoordinates] = useState({
        x: -3.8,
        y: 0.25,
        z: 0.9,
        action: "idle",
        heading: 0,
        waypoint: "start",
    })
    const [cameraMode, setCameraMode] = useState("pov") // "pov" | "cinematic" | "overhead" | "closeup"
    const [isExpanded, setIsExpanded] = useState(false)
    const [questsCollapsed, setQuestsCollapsed] = useState(false)

    // Mount the 3D Story World Scene with position tracking
    useEffect(() => {
        if (!canvasHostRef.current) return
        const scene = createStoryWorldScene(canvasHostRef.current, {
            color: characterColor,
            onPositionChange: (pos) => {
                setCoordinates((prev) => ({ ...prev, ...pos }))
            },
        })
        sceneRef.current = scene

        return () => {
            if (scene) scene.dispose()
            sceneRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // D-Pad direction step handler
    const handleStep = useCallback((direction) => {
        playClick(true)
        if (sceneRef.current) {
            sceneRef.current.moveDirection(direction, 0.75)
        }
    }, [])

    // Waypoint jump handler
    const handleJumpToWaypoint = useCallback((wpKey) => {
        playClick(true)
        invokeTool("character_move", { destination: wpKey })
    }, [])

    // Camera mode switch handler
    const handleCameraSwitch = useCallback((mode) => {
        playClick(true)
        setCameraMode(mode)
        invokeTool("camera_setView", { mode })
    }, [])

    return (
        <div className={`${css.journeyPage} ${isExpanded ? css.expandedStagePage : ""}`}>
            {/* Expansive 3D World Stage */}
            <div className={`${css.canvasStage} ${isExpanded ? css.canvasStageExpanded : ""}`}>
                {/* Dedicated WebGL Canvas Host */}
                <div className={css.webglHost} ref={canvasHostRef} />

                {/* Floating Interactive 3D D-Pad (Walk Pip in 3D Space) */}
                <div className={css.stageDpadWrap} aria-label="3D Character Movement Controls">
                    <div className={css.dpadLabel}>3D STEER</div>
                    <div className={css.dpadGrid}>
                        <button
                            className={`${css.dpadBtn} ${css.dpadUp}`}
                            onClick={() => handleStep("forward")}
                            title="Walk Forward (W / ArrowUp)"
                            aria-label="Walk Forward"
                        >
                            ▲
                        </button>
                        <button
                            className={`${css.dpadBtn} ${css.dpadLeft}`}
                            onClick={() => handleStep("left")}
                            title="Walk Left (A / ArrowLeft)"
                            aria-label="Walk Left"
                        >
                            ◄
                        </button>
                        <div className={css.dpadCenter} title={`Heading: ${coordinates.heading}°`}>
                            <span className={css.pipIcon}>🐾</span>
                        </div>
                        <button
                            className={`${css.dpadBtn} ${css.dpadRight}`}
                            onClick={() => handleStep("right")}
                            title="Walk Right (D / ArrowRight)"
                            aria-label="Walk Right"
                        >
                            ►
                        </button>
                        <button
                            className={`${css.dpadBtn} ${css.dpadDown}`}
                            onClick={() => handleStep("back")}
                            title="Walk Backward (S / ArrowDown)"
                            aria-label="Walk Backward"
                        >
                            ▼
                        </button>
                    </div>
                </div>

                {/* Floating Quick Waypoint Navigation Strip */}
                <div className={css.waypointStrip} role="group" aria-label="3D Map Waypoints">
                    <span className={css.waypointLabel}>3D WAYPOINTS:</span>
                    {Object.entries(WAYPOINTS).map(([key, wp]) => {
                        const isCurrent = coordinates.waypoint === key
                        return (
                            <button
                                key={key}
                                className={`${css.waypointBtn} ${isCurrent ? css.waypointBtnActive : ""}`}
                                onClick={() => handleJumpToWaypoint(key)}
                                title={`Walk to ${wp.name} [${wp.x}, ${wp.z}]`}
                            >
                                <span className={css.wpIcon}>{wp.icon}</span>
                                <span className={css.wpName}>{wp.name}</span>
                            </button>
                        )
                    })}
                </div>

                {/* Floating Camera Mode Switcher & Stage Maximize */}
                <div className={css.cameraControls} role="group" aria-label="Camera Perspectives">
                    <button
                        className={`${css.camBtn} ${cameraMode === "pov" ? css.camBtnActive : ""}`}
                        onClick={() => handleCameraSwitch("pov")}
                        title="Pip's Point of View (First-Person / Over-the-Shoulder POV)"
                    >
                        👁️ POV
                    </button>
                    <button
                        className={`${css.camBtn} ${cameraMode === "cinematic" ? css.camBtnActive : ""}`}
                        onClick={() => handleCameraSwitch("cinematic")}
                        title="Cinematic Follow Camera"
                    >
                        🎥 Follow
                    </button>
                    <button
                        className={`${css.camBtn} ${cameraMode === "overhead" ? css.camBtnActive : ""}`}
                        onClick={() => handleCameraSwitch("overhead")}
                        title="Top-Down Tactical Map View"
                    >
                        🗺️ Map
                    </button>
                    <button
                        className={`${css.camBtn} ${cameraMode === "closeup" ? css.camBtnActive : ""}`}
                        onClick={() => handleCameraSwitch("closeup")}
                        title="Close-Up Character Portrait"
                    >
                        🔍 Close
                    </button>
                    <button
                        className={`${css.camBtn} ${isExpanded ? css.camBtnActive : ""}`}
                        onClick={() => setIsExpanded((e) => !e)}
                        title={isExpanded ? "Standard Viewport" : "Expand 3D Stage (Theater Mode)"}
                    >
                        {isExpanded ? "⛶ Standard" : "⛶ Expand 3D"}
                    </button>
                </div>

                {/* Floating Interaction Tips */}
                <div className={css.stageHintPill}>
                    <span className={css.hintDot} />
                    <span>🖱️ Click terrain to walk Pip • ⌨️ WASD to steer in POV • 👁️ POV camera active</span>
                </div>
            </div>

            {/* Quests Toggle Bar */}
            <div className={css.drawerBar}>
                <button
                    className={css.drawerToggleBtn}
                    onClick={() => setQuestsCollapsed((c) => !c)}
                    aria-expanded={!questsCollapsed}
                >
                    <span>{questsCollapsed ? "📜 Show Story Quests & AI Director ▼" : "📜 Hide Story Quests ▲"}</span>
                </button>
            </div>

            {/* Living Journey Controller & Narrative Overlay */}
            {!questsCollapsed && (
                <div className={css.journeyOverlay}>
                    <LivingJourney
                        sceneController={sceneRef.current}
                        coordinates={coordinates}
                        onSetSceneColor={(col) => {
                            setCharacterColor(col)
                            if (sceneRef.current?.setColor) sceneRef.current.setColor(col)
                        }}
                    />
                </div>
            )}
        </div>
    )
}

Journey.setMetaData = () => [
    <title key="title">Living Quest — 3D WebMCP Story World with Pip &amp; Elder Byte</title>,
    <meta
        key="desc"
        name="description"
        content="An immersive 3D character narrative journey where AI agents control Pip, day/night cycles, choices, and ancient relics via WebMCP tools."
    />,
]
