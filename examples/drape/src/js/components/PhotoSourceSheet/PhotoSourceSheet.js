import React from "react"
import { Camera, Image as ImageIcon, Folder } from "lucide-react"
import BottomSheet from "@components/BottomSheet/BottomSheet"
import css from "./PhotoSourceSheet.scss"

const SOURCES = [
    {
        id: "camera",
        icon: Camera,
        label: "Take a photo",
        helper: "Use the camera now",
    },
    {
        id: "library",
        icon: ImageIcon,
        label: "Choose from library",
        helper: "Pick up to 5 photos",
    },
    {
        id: "files",
        icon: Folder,
        label: "Browse files",
        helper: "From iCloud Drive or Files",
    },
]

function PhotoSourceSheet({ open, onSelect, onDismiss }) {
    return (
        <BottomSheet open={open} onDismiss={onDismiss} ariaLabel="Add photos">
            <h2 className={css.title}>Add photos</h2>
            <div className={css.rows}>
                {SOURCES.map(({ id, icon: Icon, label, helper }) => (
                    <button
                        key={id}
                        type="button"
                        className={css.row}
                        onClick={() => onSelect(id)}
                    >
                        <span className={css.iconTile}>
                            <Icon size={20} strokeWidth={1.75} />
                        </span>
                        <span className={css.text}>
                            <span className={css.name}>{label}</span>
                            <span className={css.helper}>{helper}</span>
                        </span>
                    </button>
                ))}
            </div>
            <button type="button" className={css.cancel} onClick={onDismiss}>
                Cancel
            </button>
        </BottomSheet>
    )
}

export default PhotoSourceSheet
