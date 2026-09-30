import React from 'react'
import { Outlet } from 'catalyst-core'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import ScrollReset from '../components/ScrollReset'
import ShellSync from '../components/ShellSync'

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
            <BottomNav />
            <ShellSync />
        </div>
    </ThemeProvider>
)

export default DocsLayout
