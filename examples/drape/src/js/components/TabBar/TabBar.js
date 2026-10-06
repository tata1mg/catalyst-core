import React from "react"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { Home as HomeIcon, Camera, Image as ImageIcon, User } from "lucide-react"
import css from "./TabBar.scss"

const TABS = [
    { id: "home", label: "HOME", Icon: HomeIcon, path: "/" },
    { id: "shoots", label: "SHOOTS", Icon: Camera, path: "/upload-attire" },
    { id: "gallery", label: "GALLERY", Icon: ImageIcon, path: "/variants-gallery" },
    { id: "profile", label: "PROFILE", Icon: User, path: "/" },
]

function TabBar({ active }) {
    const navigate = useViewTransitionNavigate()
    return (
        <div className={css.tabWrap}>
            <div className={css.tabPill}>
                {TABS.map(({ id, label, Icon, path }) => {
                    const isActive = id === active
                    return (
                        <button
                            key={id}
                            type="button"
                            className={`${css.tab} ${isActive ? css.tabActive : ""}`}
                            onClick={() => navigate(path)}
                        >
                            <Icon size={18} strokeWidth={1.8} />
                            <span className={css.tabLabel}>{label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

export default TabBar
