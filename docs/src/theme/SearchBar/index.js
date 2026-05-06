import React, { useEffect } from 'react'
import SearchBar from '@theme-original/SearchBar'
import styles from './styles.module.css'

export default function SearchBarWrapper() {
    useEffect(() => {
        const updateText = () => {
            const placeholders = document.querySelectorAll(
                '.aa-DetachedSearchButtonPlaceholder'
            )
            placeholders.forEach((node) => {
                if (node && node.textContent !== 'Quick search...') {
                    node.textContent = 'Quick search...'
                }
            })

            const inputs = document.querySelectorAll('.navbar__search-input')
            inputs.forEach((input) => {
                if (input.getAttribute('placeholder') !== 'Quick search...') {
                    input.setAttribute('placeholder', 'Quick search...')
                }
            })
        }

        updateText()

        // Observe briefly for lazy-rendered search UI, then disconnect to avoid loops.
        const observer = new MutationObserver(() => {
            observer.disconnect()
            updateText()
            observer.observe(document.body, { childList: true, subtree: true })
        })

        observer.observe(document.body, { childList: true, subtree: true })
        const timeoutId = window.setTimeout(() => observer.disconnect(), 2000)

        return () => {
            window.clearTimeout(timeoutId)
            observer.disconnect()
        }
    }, [])

    return (
        <div className={styles.searchShell}>
            <SearchBar />
        </div>
    )
}
