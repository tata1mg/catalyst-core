import React from 'react'
import styles from './Releases.scss'

/**
 * The release film. Hosted as a GitHub release asset, so nothing is bundled
 * and nothing loads until the reader presses play (preload="none"); the
 * poster is a frame from the film, served from /img/releases.
 */
const ReleaseVideo = ({ release, title }) => (
    <div className={styles.video}>
        <video
            controls
            playsInline
            preload="none"
            poster={release.poster}
            src={release.video}
            aria-label={`${title} release film`}
        >
            <a href={release.video}>Download the {title} release film</a>
        </video>
    </div>
)

export default ReleaseVideo
