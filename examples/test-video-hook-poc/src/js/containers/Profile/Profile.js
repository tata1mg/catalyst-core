import React from "react"
import css from "./Profile.scss"

function Profile() {
    return (
        <div className={css.container}>
            <div className={css.header}>
                <h1 className={css.headerTitle}>Profile</h1>
            </div>
            
            <div className={css.content}>
                <div className={css.profileCard}>
                    <div className={css.avatar}>
                        <span className={css.avatarInitial}>U</span>
                    </div>
                    <div className={css.info}>
                        <h2 className={css.userName}>Guest User</h2>
                        <p className={css.userEmail}>guest.user@example.com</p>
                    </div>
                </div>

                <div className={css.settingsList}>
                    <div className={css.settingItem}>
                        <span className={css.settingLabel}>App Version</span>
                        <span className={css.settingValue}>1.0.0</span>
                    </div>
                    <div className={css.settingItem}>
                        <span className={css.settingLabel}>Environment</span>
                        <span className={css.settingValue}>Development</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Profile
