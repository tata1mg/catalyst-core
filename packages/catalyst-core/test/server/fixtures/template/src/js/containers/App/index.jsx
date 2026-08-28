import React from "react"

// Fixture App for the SSR handler tests (#348).
//
// App.serverSideFunction is an implicit contract: handler.jsx calls it
// unconditionally (via tracedAppServerSideFunction) on every request. All
// 6 real create-catalyst-app templates define it, so the fixture must too
// — omitting it would make every test throw in the SERVER_SIDE_FUNCTION
// stage rather than exercising the render path.
//
// The tests swap `serverSideFunction` per-case (e.g. to make it throw) via
// vi.spyOn on this module.
function App({ children }) {
    return <main data-testid="app">{children ?? "app-content"}</main>
}

App.serverSideFunction = async () => {
    // no-op by default; tests override to test the SERVER_SIDE_FUNCTION
    // error branch.
    return undefined
}

export default App
