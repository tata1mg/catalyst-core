import React from "react"
import { ArrowLeft } from "lucide-react"
import css from "./AppHeader.scss"

export function AppHeader({ children }) {
    return <header className={css.header}>{children}</header>
}

export function HeaderLeft({ children }) {
    return <div className={css.left}>{children}</div>
}

export function HeaderRight({ children }) {
    return <div className={css.right}>{children}</div>
}

export function BackButton({ onClick, label = "Back" }) {
    return (
        <button type="button" className={css.iconButton} onClick={onClick} aria-label={label}>
            <ArrowLeft size={22} />
        </button>
    )
}

export function HeaderTitle({ children }) {
    return <span className={css.title}>{children}</span>
}

export function HeaderTitleStack({ title, subtitle }) {
    return (
        <div className={css.titleStack}>
            <span className={css.title}>{title}</span>
            {subtitle && <span className={css.subtitle}>{subtitle}</span>}
        </div>
    )
}

export function StepBadge({ children }) {
    return <span className={css.stepBadge}>{children}</span>
}

export function HeaderIconButton({ icon: Icon, onClick, label, size = 20 }) {
    return (
        <button type="button" className={css.iconButton} onClick={onClick} aria-label={label}>
            <Icon size={size} />
        </button>
    )
}

export default AppHeader
