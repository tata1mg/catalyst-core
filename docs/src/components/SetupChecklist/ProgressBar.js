import React from 'react'
import styles from './styles.module.css'

const ProgressBar = ({ progress }) => {
    const { completed, total, percentage } = progress

    return (
        <div className={styles.progressContainer}>
            <div className={styles.progressHeader}>
                <span className={styles.progressText}>
                    Progress: {completed}/{total} steps completed
                </span>
                <span className={styles.progressPercentage}>{percentage}%</span>
            </div>
            <div className={styles.progressBarTrack}>
                <div
                    className={styles.progressBarFill}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            {percentage === 100 && (
                <div className={styles.completionMessage}>
                    🎉 Congratulations! You've completed all setup steps.
                </div>
            )}
        </div>
    )
}

export default ProgressBar
