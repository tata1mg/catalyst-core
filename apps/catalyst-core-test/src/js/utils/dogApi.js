export const getDogApiBaseUrl = () => {
    if (typeof window !== "undefined") return ""

    const host = process.env.NODE_SERVER_HOSTNAME || "localhost"
    const port = process.env.NODE_SERVER_PORT || 3005

    return `http://${host}:${port}`
}
