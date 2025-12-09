/**
 * Preloads non-essential chunks for the initial route
 * Uses <link rel="modulepreload"> for JS and <link rel="stylesheet"> for CSS
 */
export const preloadRequiredAssets = async () => {
    try {
        const chunks = window.__NON_ESSENTIAL_CHUNKS__ || { js: [], css: [] }
        const path = window.location.pathname

        const getUrl = (id) => (id.startsWith("http") ? id : id.startsWith("/") ? id : `/${id}`)

        // Preload JS chunks using modulepreload
        const jsLoads = chunks.js.map((id) => {
            return new Promise((resolve) => {
                const url = getUrl(id)

                // Check if already preloaded
                if (document.querySelector(`link[href="${url}"]`)) {
                    resolve(true)
                    return
                }

                const link = document.createElement("link")
                link.rel = "modulepreload"
                link.href = url
                link.onload = () => resolve(true)
                link.onerror = () => resolve(false)
                document.head.appendChild(link)
            })
        })

        // Load CSS chunks
        const cssLoads = chunks.css.map((id) => {
            return new Promise((resolve) => {
                const url = getUrl(id)

                if (document.querySelector(`link[href="${url}"]`)) {
                    resolve(true)
                    return
                }

                const link = document.createElement("link")
                link.rel = "stylesheet"
                link.href = url
                link.onload = () => resolve(true)
                link.onerror = () => resolve(false)
                document.head.appendChild(link)
            })
        })

        const results = await Promise.all([...jsLoads, ...cssLoads])
        const succeeded = results.filter(Boolean).length
        const failed = results.length - succeeded
    } catch (error) {
        console.error("[Hydration] Preload error:", error)
    }
}
