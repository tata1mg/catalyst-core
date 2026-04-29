import React from 'react'
import styles from './styles.module.css'

const getYouTubeId = (url) => {
    try {
        const parsed = new URL(url)

        if (parsed.hostname.includes('youtu.be')) {
            return parsed.pathname.replace('/', '')
        }

        return parsed.searchParams.get('v')
    } catch (error) {
        return null
    }
}

const VideoCard = ({ title, url, featured = false }) => {
    const videoId = getYouTubeId(url)
    const thumbnail = videoId
        ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        : 'https://placehold.co/640x360?text=Video'

    return (
        <a
            className={`${styles.card} ${featured ? styles.featuredCard : ''}`}
            href={url}
            target="_blank"
            rel="noreferrer"
        >
            <div className={styles.thumbnailWrap}>
                <img className={styles.thumbnail} src={thumbnail} alt={title} />
                <div className={styles.playBadge}>YouTube</div>
            </div>
            <div className={styles.body}>
                <h3 className={styles.title}>{title}</h3>
                <p className={styles.meta}>Watch the full talk on YouTube</p>
            </div>
        </a>
    )
}

export default function VideoLinkGrid({ items, featured = false }) {
    return (
        <div className={featured ? styles.featuredGrid : styles.grid}>
            {items.map((item) => (
                <VideoCard
                    key={`${item.title}-${item.url}`}
                    title={item.title}
                    url={item.url}
                    featured={featured}
                />
            ))}
        </div>
    )
}
