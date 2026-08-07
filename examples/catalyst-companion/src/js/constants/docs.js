// The documentation is a separate deployment, not a route in this app.
//
// Companion used to compile docs/content into bundled routes under /content.
// It now points at the deployed site instead, so there is exactly one renderer
// and the app cannot serve stale copies of pages that have moved on.
//
// Production mounts the docs under /public_docs (the site 302s / to it), so the
// prefix belongs in this URL. Link to the origin rather than a specific page:
// the docs server owns which page comes first, and that redirect outlives any
// path we would hardcode here.
export const DOCS_URL = "https://catalyst.1mg.com/public_docs"

export const docsPageUrl = (slug) => `${DOCS_URL}/content/${slug}`
