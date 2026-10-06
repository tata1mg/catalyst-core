import React from "react"
import { Check } from "lucide-react"
import BottomSheet from "@components/BottomSheet/BottomSheet"
import css from "./RadioListSheet.scss"

function RadioListSheet({ open, title, options, value, onSelect, onDismiss }) {
    return (
        <BottomSheet open={open} onDismiss={onDismiss} ariaLabel={title}>
            <h2 className={css.title}>{title}</h2>
            <ul className={css.list} role="radiogroup">
                {options.map(({ id, label }) => {
                    const selected = id === value
                    return (
                        <li key={id}>
                            <button
                                type="button"
                                className={`${css.row} ${selected ? css.rowSelected : ""}`}
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onSelect(id)}
                            >
                                <span className={css.label}>{label}</span>
                                {selected && (
                                    <Check
                                        size={20}
                                        strokeWidth={1.75}
                                        className={css.check}
                                    />
                                )}
                            </button>
                        </li>
                    )
                })}
            </ul>
            <button type="button" className={css.cancel} onClick={onDismiss}>
                Cancel
            </button>
        </BottomSheet>
    )
}

export default RadioListSheet
