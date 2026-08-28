import React from "react"

// Fixture route table for the SSR handler tests (#348). One concrete
// route ("/") plus a catch-all ("*") so tests can exercise both the
// 200 and the 404 (no-match) status branches in _renderMarkUp.

function HomePage() {
    return <p data-testid="home">home</p>
}

function NotFoundPage() {
    return <p data-testid="notfound">not found</p>
}

const routes = [
    { path: "/", component: HomePage },
    { path: "*", component: NotFoundPage },
]

export default routes
