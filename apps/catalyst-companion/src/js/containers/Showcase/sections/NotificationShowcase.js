import React, { useState } from "react"
import { useNotification } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import css from "../Showcase.scss"

const NotificationShowcase = () => {
    const { permissionStatus, requestPermission, schedule, isNative } = useNotification()
    const [title, setTitle] = useState("Catalyst Companion")
    const [body, setBody] = useState("Delivered by the native bridge.")
    const [sent, setSent] = useState(false)

    const granted = permissionStatus === "granted"

    const send = () => {
        schedule({ title, body, id: `showcase-${Date.now()}` })
        setSent(true)
        setTimeout(() => setSent(false), 2500)
    }

    return (
        <>
            <ShowcaseBar title="Local Notification" />
            <p className={css.lede}>
                Requests real OS notification permission and posts a local notification
                straight from the web layer.
            </p>

            {!isNative && (
                <div className={css.bannerInfo}>
                    System notifications need the Companion app&rsquo;s bridge.
                </div>
            )}
            {sent && <div className={css.bannerInfo}>Notification scheduled — check the shade.</div>}

            <div className={css.group}>
                <div className={css.permState}>
                    <strong>{permissionStatus || "undetermined"}</strong>
                    <span>notification permission</span>
                </div>
            </div>

            {!granted && (
                <button
                    type="button"
                    className={css.btnPrimary}
                    onClick={requestPermission}
                    disabled={!isNative}
                >
                    Request Permission
                </button>
            )}

            <div className={css.group} style={{ marginTop: 16 }}>
                <input
                    className={css.input}
                    placeholder="Title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <div style={{ borderTop: "1px solid var(--hub-border)" }}>
                    <input
                        className={css.input}
                        placeholder="Body"
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                    />
                </div>
            </div>

            <button
                type="button"
                className={granted ? css.btnPrimary : css.btn}
                onClick={send}
                disabled={!isNative}
            >
                Send Test Notification
            </button>
        </>
    )
}

export default NotificationShowcase
