import React from "react"
import Home from "./Home.jsx"

export default function App() {
    return <Home />
}

// Every Catalyst app defines this (all create-catalyst-app templates do). The
// SSR handler calls it unconditionally; a hand-rolled app that omits it throws
// a TypeError on every request. RUNTIME-WEB-003's scenario replaces this with a
// version that throws, to exercise the coded error.
App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}
