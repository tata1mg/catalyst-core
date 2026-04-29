import React from 'react'
import { Switch } from 'antd'
import styles from './styles.module.css'

const ChecklistToggle = ({ viewMode, onToggle, disabled = false }) => {
    const isInteractive = viewMode === 'interactive'

    return (
        <div className={styles.toggleContainer}>
            <div className={styles.toggleWrapper}>
                <span className={styles.toggleLabel}>
                    📖 Documentation View
                </span>
                <Switch
                    checked={isInteractive}
                    onChange={onToggle}
                    disabled={disabled}
                    className={styles.toggleSwitch}
                    size="default"
                />
                <span className={styles.toggleLabel}>
                    ✅ Interactive Checklist
                </span>
            </div>
            <div className={styles.toggleDescription}>
                {isInteractive
                    ? 'Track your progress with an interactive checklist'
                    : 'View the complete documentation'}
            </div>
        </div>
    )
}

export default ChecklistToggle
