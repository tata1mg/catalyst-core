import React from 'react'
import { Outlet } from 'catalyst-core'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'
import ScrollReset from '../components/ScrollReset'

/**
 * Site chrome. The docs grid itself (sidebar, article, TOC) belongs to
 * DocPage, which renders `.docs-shell` per page — this only wraps it in the
 * navbar and theme.
 */
const DocsLayout = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <ScrollReset />
        <div className="docs-site">
            <Navbar />
            <Outlet />
        </div>
    </ThemeProvider>
)

export default DocsLayout
