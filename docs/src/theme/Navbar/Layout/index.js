import React from 'react'
import clsx from 'clsx'
import { useThemeConfig } from '@docusaurus/theme-common'
import {
    useHideableNavbar,
    useNavbarMobileSidebar,
} from '@docusaurus/theme-common/internal'
import NavbarMobileSidebar from '@theme/Navbar/MobileSidebar'
import styles from './styles.module.css'

function NavbarBackdrop(props) {
    return (
        <div
            role="presentation"
            {...props}
            className={clsx('navbar-sidebar__backdrop', props.className)}
        />
    )
}

export default function NavbarLayout({ children }) {
    const {
        navbar: { hideOnScroll, style },
    } = useThemeConfig()
    const mobileSidebar = useNavbarMobileSidebar()
    const { navbarRef, isNavbarVisible } = useHideableNavbar(hideOnScroll)

    return (
        <nav
            ref={navbarRef}
            style={{
                margin: 0,
                padding: 0,
                inset: '0 0 auto 0',
                left: 0,
                right: 0,
                top: 0,
                width: '100%',
                maxWidth: '100%',
                borderRadius: 0,
            }}
            className={clsx(
                'navbar',
                'navbar--fixed-top',
                hideOnScroll && [
                    styles.navbarHideable,
                    !isNavbarVisible && styles.navbarHidden,
                ],
                {
                    'navbar--dark': style === 'dark',
                    'navbar--primary': style === 'primary',
                    'navbar-sidebar--show': mobileSidebar.shown,
                }
            )}
        >
            {children}
            <NavbarBackdrop onClick={mobileSidebar.toggle} />
            <NavbarMobileSidebar />
        </nav>
    )
}
