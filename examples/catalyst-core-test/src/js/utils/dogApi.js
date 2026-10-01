const dogBreeds = {
    affenpinscher: [],
    beagle: [],
    boxer: [],
    bulldog: ["boston", "english", "french"],
    chihuahua: [],
    dalmatian: [],
    doberman: [],
    husky: [],
    labrador: [],
    malamute: [],
    pug: [],
    retriever: ["golden"],
}

const dogImages = [
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23e8f1ff'/%3E%3Ccircle cx='160' cy='108' r='54' fill='%237a4f2a'/%3E%3Ccircle cx='137' cy='96' r='8' fill='%23000'/%3E%3Ccircle cx='183' cy='96' r='8' fill='%23000'/%3E%3Cpath d='M140 132q20 18 40 0' stroke='%23000' stroke-width='8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
]

export const getDogApiBaseUrl = () => {
    if (typeof window !== "undefined") return ""

    const host = process.env.NODE_SERVER_HOSTNAME || "localhost"
    const port = process.env.NODE_SERVER_PORT || 3005

    return `http://${host}:${port}`
}

export const getDogBreeds = () => ({
    message: dogBreeds,
    status: "success",
})

export const getDogImages = () => ({
    message: dogImages,
    status: "success",
})
