import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import PropTypes from "prop-types"
import {
    useCamera,
    useDeviceInfo,
    useHapticFeedback,
    useNetworkStatus,
    useNotification,
    useSafeArea,
} from "catalyst-core/hooks"
import css from "./Home.scss"

// Importing keeps Vite emitting these into build/client/assets/images/.
// Under SSR the import resolves against the server build base (/server/...),
// which is never served — so the filename is taken from the import and
// re-rooted at the client asset path that the express server does serve.
import kyotoAsset from "../../../static/img/kyoto.jpg"
import lisbonAsset from "../../../static/img/lisbon.jpg"

const clientAsset = (assetUrl) =>
    `/assets/client/assets/images/${assetUrl.split("/").pop()}`

const PHOTO_KYOTO = clientAsset(kyotoAsset)
const PHOTO_LISBON = clientAsset(lisbonAsset)

const PLACES = [
    { place: "Fushimi Inari", region: "Kyoto, Japan", temp: "18°" },
    { place: "Alfama", region: "Lisbon, Portugal", temp: "23°" },
    { place: "Blue Lagoon", region: "Reykjavík, Iceland", temp: "6°" },
    { place: "Jemaa el-Fnaa", region: "Marrakesh, Morocco", temp: "29°" },
    { place: "Nyhavn", region: "Copenhagen, Denmark", temp: "14°" },
]

const SEED_ENTRIES = [
    {
        id: "seed-kyoto",
        place: "Fushimi Inari",
        region: "Kyoto, Japan",
        note: "Ten thousand gates. Climbed past the crowds until it was just cedar and rain.",
        date: "14 Apr",
        temp: "18°",
        photo: PHOTO_KYOTO,
    },
    {
        id: "seed-lisbon",
        place: "Alfama",
        region: "Lisbon, Portugal",
        note: "Got lost on purpose. Found a tiny bar playing fado to four people.",
        date: "2 Mar",
        temp: "23°",
        photo: PHOTO_LISBON,
    },
]

function Stat({ value, label }) {
    return (
        <div className={css.stat}>
            <span className={css.statValue}>{value}</span>
            <span className={css.statLabel}>{label}</span>
        </div>
    )
}

Stat.propTypes = {
    value: PropTypes.node.isRequired,
    label: PropTypes.string.isRequired,
}

function Entry({ entry, isFresh }) {
    return (
        <article className={`${css.entry} ${isFresh ? css.entryFresh : ""}`}>
            <div className={css.entryPhotoWrap}>
                {entry.photo ? (
                    <img className={css.entryPhoto} src={entry.photo} alt={entry.place} />
                ) : (
                    <div className={css.entryPhotoEmpty}>◌</div>
                )}
                <span className={css.entryDate}>{entry.date}</span>
                {isFresh && <span className={css.entryNew}>New</span>}
            </div>
            <div className={css.entryBody}>
                <div className={css.entryHead}>
                    <h3 className={css.entryPlace}>{entry.place}</h3>
                    {entry.temp && <span className={css.entryTemp}>{entry.temp}</span>}
                </div>
                <p className={css.entryRegion}>{entry.region}</p>
                <p className={css.entryNote}>{entry.note}</p>
            </div>
        </article>
    )
}

Entry.propTypes = {
    entry: PropTypes.object.isRequired,
    isFresh: PropTypes.bool,
}

function Home() {
    const [entries, setEntries] = useState(SEED_ENTRIES)
    const [freshId, setFreshId] = useState(null)
    const [toast, setToast] = useState(null)
    const nextPlace = useRef(0)

    const safeArea = useSafeArea()
    const { deviceInfo } = useDeviceInfo()
    const network = useNetworkStatus()
    const haptics = useHapticFeedback()
    const camera = useCamera()
    const notification = useNotification()

    // The bridge returns the image as `fileSrc` (a data: or file: URL).
    const capturedUri = camera.photo?.fileSrc || camera.data?.fileSrc

    // Ask once, up front, so the prompt never interrupts a capture later on.
    useEffect(() => {
        notification.requestPermission?.()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const shoot = useCallback(() => {
        haptics.execute?.({ type: "medium" })
        camera.takePhoto?.()
    }, [haptics, camera])

    const pendingEntry = useMemo(() => {
        if (!capturedUri) return null
        const seed = PLACES[nextPlace.current % PLACES.length]
        return {
            id: `shot-${nextPlace.current}-${capturedUri.length}`,
            place: seed.place,
            region: seed.region,
            temp: seed.temp,
            note: deviceInfo?.model
                ? `Captured on ${deviceInfo.model}.`
                : "Captured moments ago.",
            date: "Today",
            photo: capturedUri,
        }
    }, [capturedUri, deviceInfo])

    const saveEntry = useCallback(() => {
        if (!pendingEntry) return
        haptics.execute?.({ type: "heavy" })
        nextPlace.current += 1

        setEntries((current) => [pendingEntry, ...current])
        setFreshId(pendingEntry.id)
        setToast(`${pendingEntry.place} added to your journal`)

        notification.scheduleLocal?.({
            id: `entry-${pendingEntry.id}`,
            title: "Entry saved ✓",
            body: `${pendingEntry.place} — ${pendingEntry.region}`,
        })

        camera.clearPhoto?.()
    }, [pendingEntry, haptics, notification, camera])

    useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 2800)
        return () => clearTimeout(timer)
    }, [toast])

    // Never let a failed capture look like nothing happened.
    useEffect(() => {
        if (camera.error) setToast(camera.error.message || "Couldn't capture that photo")
    }, [camera.error])

    useEffect(() => {
        if (!freshId) return undefined
        const timer = setTimeout(() => setFreshId(null), 2600)
        return () => clearTimeout(timer)
    }, [freshId])

    const countries = useMemo(
        () => new Set(entries.map((entry) => entry.region.split(",").pop().trim())).size,
        [entries]
    )

    return (
        <div
            className={css.shell}
            style={{
                paddingTop: `${safeArea.top || 0}px`,
                paddingBottom: `${(safeArea.bottom || 0) + 96}px`,
            }}
        >
            <div className={css.aurora} aria-hidden="true" />

            <header className={css.top}>
                <div className={css.topRow}>
                    <div>
                        <p className={css.greeting}>Good evening, Mayan</p>
                        <h1 className={css.brand}>Wanderlog</h1>
                    </div>
                    <div className={css.avatar}>M</div>
                </div>

                {!network.online && (
                    <div className={css.offline}>
                        <span className={css.offlineDot} />
                        Offline — entries will sync later
                    </div>
                )}

                <div className={css.stats}>
                    <Stat value={entries.length} label="entries" />
                    <Stat value={countries} label="countries" />
                    <Stat value="2026" label="season" />
                </div>
            </header>

            {pendingEntry && (
                <section className={css.pending}>
                    <img className={css.pendingPhoto} src={pendingEntry.photo} alt="New capture" />
                    <div className={css.pendingBar}>
                        <div>
                            <span className={css.pendingLabel}>{pendingEntry.place}</span>
                            <span className={css.pendingRegion}>{pendingEntry.region}</span>
                        </div>
                        <div className={css.pendingActions}>
                            <button
                                className={css.btnGhost}
                                type="button"
                                onClick={() => camera.clearPhoto?.()}
                            >
                                Discard
                            </button>
                            <button className={css.btnSave} type="button" onClick={saveEntry}>
                                Save
                            </button>
                        </div>
                    </div>
                </section>
            )}

            <div className={css.sectionHead}>
                <h2 className={css.sectionTitle}>Recent</h2>
                <span className={css.sectionMeta}>{entries.length} moments</span>
            </div>

            <div className={css.feed}>
                {entries.map((entry) => (
                    <Entry key={entry.id} entry={entry} isFresh={entry.id === freshId} />
                ))}
            </div>

            {toast && <div className={css.toast}>{toast}</div>}

            <button
                className={css.fab}
                type="button"
                onClick={shoot}
                disabled={camera.isLoading}
                aria-label="Capture a new entry"
            >
                {camera.isLoading ? "···" : "＋"}
            </button>
        </div>
    )
}

export default Home
