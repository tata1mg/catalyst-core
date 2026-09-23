import React from "react"

/**
 * Port of the docs site's VideoLinkGrid: YouTube link cards with thumbnails.
 * Same props contract: `items` = [{ title, url }], `featured` boolean.
 */
const getYouTubeId = (url) => {
    try {
        const parsed = new URL(url)
        if (parsed.hostname === "youtu.be") {
            return parsed.pathname.slice(1) || null
        }
        return parsed.searchParams.get("v")
    } catch {
        return null
    }
}

const VideoCard = ({ title, url, featured }) => {
    const videoId = getYouTubeId(url)
    const thumbnail = videoId
        ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        : "https://placehold.co/640x360?text=Video"

    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`video-card ${featured ? "video-card-featured" : ""}`}
        >
            <span className="video-thumbnail-wrap">
                <img src={thumbnail} alt={title} className="video-thumbnail" loading="lazy" />
                <span className="video-play-badge">YouTube</span>
            </span>
            <span className="video-card-body">
                <h3 className="video-card-title">{title}</h3>
                <p className="video-card-meta">Watch the full talk on YouTube</p>
            </span>
        </a>
    )
}

const VideoLinkGrid = ({ items = [], featured = false }) => (
    <div className={featured ? "video-grid-featured" : "video-grid"}>
        {items.map((item) => (
            <VideoCard key={item.url} title={item.title} url={item.url} featured={featured} />
        ))}
    </div>
)

export default VideoLinkGrid
