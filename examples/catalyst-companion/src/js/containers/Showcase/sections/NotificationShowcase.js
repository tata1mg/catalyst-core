import React, { useState } from "react"
import { useNotification } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import kit from "../../shared/appKit.scss"
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
            <p className={kit.lede}>
                Requests real OS notification permission and posts a local notification
                straight from the web layer.
            </p>

            {!isNative && (
                <div className={kit.bannerInfo}>
                    System notifications need the Companion app&rsquo;s bridge.
                </div>
            )}
            {sent && <div className={kit.bannerInfo}>Notification scheduled — check the shade.</div>}

            <div className={kit.group}>
                <div className={css.permState}>
                    <strong>{permissionStatus || "undetermined"}</strong>
                    <span>notification permission</span>
                </div>
            </div>

            {!granted && (
                <button
                    type="button"
                    className={kit.btnPrimary}
                    onClick={requestPermission}
                    disabled={!isNative}
                >
                    Request Permission
                </button>
            )}

            <div className={`${kit.group} ${css.stackTop}`}>
                <input
                    className={kit.input}
                    placeholder="Title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <input
                    className={kit.input}
                    placeholder="Body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                />
            </div>

            <button
                type="button"
                className={granted ? kit.btnPrimary : kit.btn}
                onClick={send}
                disabled={!isNative}
            >
                Send Test Notification
            </button>
        </>
    )
}

export default NotificationShowcase
