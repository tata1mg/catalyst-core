import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

const ThemeContext = createContext({ theme: "light", toggleTheme: () => {} })

const STORAGE_KEY = "catalyst-hub.theme"

const getInitialTheme = () => {
    // On the client the DocumentBootstrap inline script has already stamped
    // the attribute pre-paint; mirror it so React state matches the painted
    // theme.
    if (typeof document !== "undefined") {
        const applied = document.documentElement.getAttribute("data-theme")
        if (applied === "light" || applied === "dark") return applied
    }
    // Matches the docs site: colorMode.defaultMode is 'dark'.
    return "dark"
}

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(getInitialTheme)

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme)
    }, [theme])

    const toggleTheme = useCallback(() => {
        setTheme((current) => {
            const next = current === "light" ? "dark" : "light"
            try {
                window.localStorage.setItem(STORAGE_KEY, next)
            } catch {
                // Persistence is best-effort.
            }
            return next
        })
    }, [])

    return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
