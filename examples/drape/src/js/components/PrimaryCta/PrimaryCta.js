import React from "react"
import css from "./PrimaryCta.scss"

function PrimaryCta({ children, icon: Icon, iconPosition = "right", onClick, type = "button" }) {
    const iconNode = Icon ? <Icon size={18} strokeWidth={2} /> : null
    return (
        <button type={type} className={css.cta} onClick={onClick}>
            {iconPosition === "left" && iconNode}
            <span>{children}</span>
            {iconPosition === "right" && iconNode}
        </button>
    )
}

export default PrimaryCta
