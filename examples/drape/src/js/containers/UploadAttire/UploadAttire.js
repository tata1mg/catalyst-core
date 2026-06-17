import React, { useEffect, useRef, useState } from "react"
import { useSelector, useDispatch } from "react-redux"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { ArrowRight, Check, ChevronRight, Plus, Upload, X } from "lucide-react"
import { useCamera, useFilePicker } from "catalyst-core/hooks"

import {
    AppHeader,
    BackButton,
    HeaderTitle,
    StepBadge,
} from "@components/AppHeader/AppHeader"
import TabBar from "@components/TabBar/TabBar"
import PrimaryCta from "@components/PrimaryCta/PrimaryCta"
import FadeImage from "@components/FadeImage/FadeImage"
import PhotoSourceSheet from "@components/PhotoSourceSheet/PhotoSourceSheet"
import RadioListSheet from "@components/RadioListSheet/RadioListSheet"

import {
    addPhoto,
    removePhoto,
    setAttireType,
    setFabric,
} from "@containers/UploadAttire/reducer.js"

import css from "./UploadAttire.scss"

function Thumb({ src, index, alt, onRemove }) {
    return (
        <div className={css.thumbCell}>
            <FadeImage
                src={src}
                alt={alt}
                delayMs={Math.min(index, 3) * 60}
                className={css.thumb}
                variant="develop"
            />
            {onRemove && (
                <button
                    type="button"
                    className={css.thumbRemove}
                    onClick={onRemove}
                    aria-label={`Remove ${alt}`}
                >
                    <X size={12} strokeWidth={2.5} />
                </button>
            )}
        </div>
    )
}

// TODO: API — replace with the real upload pipeline (multipart POST → uploadId/previewUrl).
// Visual mock only: pre-populated thumbnails so the contact-sheet strip reads correctly.
const MOCK_THUMBS = [
    "/static/upload-attire/thumb-1.png",
    "/static/upload-attire/thumb-2.png",
    "/static/upload-attire/thumb-3.png",
]

const ATTIRE_OPTIONS = [
    { id: "Saree", label: "Saree" },
    { id: "Lehenga", label: "Lehenga" },
    { id: "Kurta", label: "Kurta" },
    { id: "Anarkali", label: "Anarkali" },
    { id: "Sherwani", label: "Sherwani" },
    { id: "Dupatta", label: "Dupatta" },
]

const FABRIC_OPTIONS = [
    { id: "Silk", label: "Silk" },
    { id: "Cotton", label: "Cotton" },
    { id: "Linen", label: "Linen" },
    { id: "Chiffon", label: "Chiffon" },
    { id: "Georgette", label: "Georgette" },
    { id: "Velvet", label: "Velvet" },
]

const DEFAULT_ATTIRE = "Saree"
const DEFAULT_FABRIC = "Silk"

function UploadTile({ onClick, atCap }) {
    const Icon = atCap ? Check : Upload
    return (
        <button
            type="button"
            className={css.uploadTile}
            onClick={onClick}
            disabled={atCap}
        >
            <span className={css.uploadIconBg}>
                <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className={css.uploadPrimary}>
                {atCap ? "All set" : "Tap to add photos"}
            </span>
            <span className={css.uploadSecondary}>
                {atCap ? `${PHOTO_LIMIT} of ${PHOTO_LIMIT} added` : "JPG or PNG, up to 5"}
            </span>
        </button>
    )
}

function ThumbnailStrip({ items, onAddMore, showAddMore, onRemove }) {
    return (
        <div className={css.thumbStrip}>
            {items.map((item, i) => (
                <Thumb
                    key={item.id}
                    src={item.url}
                    index={i}
                    alt={`Attire photo ${i + 1}`}
                    onRemove={item.removable ? () => onRemove(item.id) : null}
                />
            ))}
            {showAddMore && (
                <button
                    type="button"
                    className={css.thumbAdd}
                    onClick={onAddMore}
                    aria-label="Add more photos"
                >
                    <Plus size={18} strokeWidth={1.75} />
                </button>
            )}
        </div>
    )
}

function FieldRow({ label, value, onClick }) {
    return (
        <button type="button" className={css.fieldRow} onClick={onClick}>
            <span className={css.fieldStack}>
                <span className={css.fieldLabel}>{label}</span>
                <span className={css.fieldValue}>{value}</span>
            </span>
            <ChevronRight size={20} strokeWidth={1.75} className={css.fieldChevron} />
        </button>
    )
}

const PHOTO_LIMIT = 5

// crypto.randomUUID requires a secure context (HTTPS or localhost). On a LAN-IP
// dev host (e.g. http://192.168.x.x — which the iOS WebView loads from), it is
// undefined. Photo IDs are local-only, so a millisecond+random suffix is enough.
const newPhotoId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function UploadAttire() {
    const dispatch = useDispatch()
    const navigate = useViewTransitionNavigate()
    const { photos, attireType, fabric } = useSelector(
        (state) => state.uploadAttireReducer
    )

    const camera = useCamera()
    const filePicker = useFilePicker()

    const [activeSheet, setActiveSheet] = useState(null)
    const webInputRef = useRef(null)

    const stripItems =
        photos.length > 0
            ? photos.map((p) => ({ id: p.id, url: p.url, removable: true }))
            : MOCK_THUMBS.map((url, i) => ({
                id: `mock-${i}`,
                url,
                removable: false,
            }))
    const attireValue = attireType ?? DEFAULT_ATTIRE
    const fabricValue = fabric ?? DEFAULT_FABRIC
    const remainingSlots = Math.max(0, PHOTO_LIMIT - photos.length)

    const closeSheet = () => setActiveSheet(null)

    const cameraData = camera.data
    const cameraError = camera.error
    const cameraClear = camera.clear
    const cameraClearError = camera.clearError

    const filePickerData = filePicker.data
    const filePickerError = filePicker.error
    const filePickerClear = filePicker.clear
    const filePickerClearError = filePicker.clearError

    // Dedupe each catalyst data ref so a single selection only dispatches once.
    // Under React 18 + useSyncExternalStore, redux dispatches inside the effect
    // can trigger re-renders before filePicker.clear() commits, re-running this
    // effect with the same data ref. Recovery and root cause are documented in
    // docs/REPO-CONVENTIONS.md › Framework notes.
    const processedCameraDataRef = useRef(null)
    const processedFilePickerDataRef = useRef(null)

    useEffect(() => {
        if (!cameraData?.fileSrc) return
        if (processedCameraDataRef.current === cameraData) return
        processedCameraDataRef.current = cameraData
        dispatch(addPhoto({ id: newPhotoId(), url: cameraData.fileSrc }))
        cameraClear()
    }, [cameraData, cameraClear, dispatch])

    useEffect(() => {
        if (!filePickerData) return
        console.log("filePickerData", filePickerData)
        if (processedFilePickerDataRef.current === filePickerData) return
        processedFilePickerDataRef.current = filePickerData
        const files =
            filePickerData.files ??
            (filePickerData.fileSrc ? [filePickerData] : [])
        for (const f of files) {
            if (f?.fileSrc) {
                dispatch(addPhoto({ id: newPhotoId(), url: f.fileSrc }))
            }
        }
        filePickerClear()
    }, [filePickerData, filePickerClear, dispatch])

    useEffect(() => {
        if (!cameraError) return
        // TODO: UX — wire to a toast/snackbar component once one exists.
        // eslint-disable-next-line no-console
        console.warn("camera error:", cameraError)
        cameraClearError()
    }, [cameraError, cameraClearError])

    useEffect(() => {
        if (!filePickerError) return
        // TODO: UX — wire to a toast/snackbar component once one exists.
        // eslint-disable-next-line no-console
        console.warn("file pick error:", filePickerError)
        filePickerClearError()
    }, [filePickerError, filePickerClearError])

    const openWebFilePicker = ({ accept, multiple, capture }) => {
        const input = webInputRef.current
        if (!input) return
        input.accept = accept
        input.multiple = multiple
        if (capture) input.setAttribute("capture", "environment")
        else input.removeAttribute("capture")
        input.click()
    }

    const handleWebFileChange = (e) => {
        const picked = Array.from(e.target.files ?? []).slice(0, remainingSlots)
        for (const file of picked) {
            const url = URL.createObjectURL(file)
            dispatch(addPhoto({ id: newPhotoId(), url }))
        }
        e.target.value = ""
    }

    const handlePhotoSource = (source) => {
        closeSheet()
        if (remainingSlots <= 0) {
            // eslint-disable-next-line no-console
            console.warn(`upload limit reached (${PHOTO_LIMIT} photos)`)
            return
        }
        if (source === "camera") {
            if (camera.isNative) {
                camera.takePhoto()
            } else {
                openWebFilePicker({
                    accept: "image/*",
                    multiple: false,
                    capture: true,
                })
            }
        } else if (source === "library") {
            if (filePicker.isNative) {
                filePicker.pickFile({
                    mimeType: "image/*",
                    multiple: remainingSlots > 1,
                    maxFiles: remainingSlots,
                })
            } else {
                openWebFilePicker({
                    accept: "image/*",
                    multiple: remainingSlots > 1,
                })
            }
        } else if (source === "files") {
            if (filePicker.isNative) {
                filePicker.pickFile({ mimeType: "*/*" })
            } else {
                openWebFilePicker({ accept: "*/*", multiple: false })
            }
        }
    }

    const handleRemovePhoto = (id) => {
        const target = photos.find((p) => p.id === id)
        if (target?.url?.startsWith("blob:")) {
            URL.revokeObjectURL(target.url)
        }
        dispatch(removePhoto(id))
    }

    const handleSelectAttire = (id) => {
        dispatch(setAttireType(id))
        closeSheet()
    }

    const handleSelectFabric = (id) => {
        dispatch(setFabric(id))
        closeSheet()
    }

    return (
        <div className="screen">
            <div className={css.body}>
                <AppHeader>
                    <BackButton onClick={() => navigate(-1)} />
                    <HeaderTitle>New Shoot</HeaderTitle>
                    <StepBadge>1 of 3</StepBadge>
                </AppHeader>

                <section className={css.section}>
                    <h2 className={css.sectionTitle}>Upload your attire</h2>
                    <UploadTile
                        onClick={() => setActiveSheet("photo")}
                        atCap={remainingSlots === 0}
                    />
                    <ThumbnailStrip
                        items={stripItems}
                        onAddMore={() => setActiveSheet("photo")}
                        showAddMore={remainingSlots > 0}
                        onRemove={handleRemovePhoto}
                    />
                </section>

                <section className={css.section}>
                    <h2 className={css.sectionTitle}>Attire details</h2>
                    <div className={css.fieldList}>
                        <FieldRow
                            label="Type of attire"
                            value={attireValue}
                            onClick={() => setActiveSheet("attireType")}
                        />
                        <FieldRow
                            label="Fabric"
                            value={fabricValue}
                            onClick={() => setActiveSheet("fabric")}
                        />
                    </div>
                </section>
            </div>

            <div className={css.continueArea}>
                <PrimaryCta icon={ArrowRight} onClick={() => navigate("/shoot-type")}>
                    Continue
                </PrimaryCta>
            </div>

            <TabBar active="shoots" />

            <input
                ref={webInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleWebFileChange}
            />

            <PhotoSourceSheet
                open={activeSheet === "photo"}
                onSelect={handlePhotoSource}
                onDismiss={closeSheet}
            />
            <RadioListSheet
                open={activeSheet === "attireType"}
                title="Type of attire"
                options={ATTIRE_OPTIONS}
                value={attireValue}
                onSelect={handleSelectAttire}
                onDismiss={closeSheet}
            />
            <RadioListSheet
                open={activeSheet === "fabric"}
                title="Fabric"
                options={FABRIC_OPTIONS}
                value={fabricValue}
                onSelect={handleSelectFabric}
                onDismiss={closeSheet}
            />
        </div>
    )
}

export default UploadAttire
