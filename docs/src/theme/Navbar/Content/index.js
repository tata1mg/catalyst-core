import React from 'react'
import { useThemeConfig } from '@docusaurus/theme-common'
import {
    splitNavbarItems,
    useNavbarMobileSidebar,
} from '@docusaurus/theme-common/internal'
import NavbarItem from '@theme/NavbarItem'
import NavbarColorModeToggle from '@theme/Navbar/ColorModeToggle'
import SearchBar from '@theme/SearchBar'
import NavbarMobileSidebarToggle from '@theme/Navbar/MobileSidebar/Toggle'
import NavbarLogo from '@theme/Navbar/Logo'
import NavbarSearch from '@theme/Navbar/Search'

import styles from './styles.module.css'

function useNavbarItems() {
    return useThemeConfig().navbar.items
}

function NavbarItems({ items }) {
    return (
        <>
            {items.map((item, i) => (
                <NavbarItem {...item} key={i} />
            ))}
        </>
    )
}

export default function NavbarContent() {
    const mobileSidebar = useNavbarMobileSidebar()

    const items = useNavbarItems()
    const [leftItems, rightItems] = splitNavbarItems(items)

    const leftSearchItems = leftItems.filter((item) => item.type === 'search')
    const leftNavItems = leftItems.filter((item) => item.type !== 'search')

    return (
        <div
            className={`navbar__inner ${styles.navbarInner}`}
            style={{ width: '100%', maxWidth: '100%', margin: 0, padding: 0 }}
        >
            <div className={`navbar__items ${styles.leftZone}`}>
                {!mobileSidebar.disabled && <NavbarMobileSidebarToggle />}
                <NavbarLogo />
            </div>

            <div className={`navbar__items ${styles.centerZone}`}>
                <NavbarItems items={leftNavItems} />
            </div>

            <div
                className={`navbar__items navbar__items--right ${styles.rightZone}`}
            >
                <div className={styles.searchWrap}>
                    <NavbarItems items={leftSearchItems} />
                </div>
                <div className={styles.rightDivider} />
                <NavbarItems items={rightItems} />
                <NavbarColorModeToggle className={styles.colorModeToggle} />
                {leftSearchItems.length === 0 && (
                    <NavbarSearch>
                        <SearchBar />
                    </NavbarSearch>
                )}
            </div>
        </div>
    )
}
