const path = require('node:path')
const fs = require('node:fs')
const config = require('../config.json')
const themeInfo = config?.docs?.theme

let lightModeTheme
let darkModeTheme
if (Array.isArray(themeInfo)) {
    themeInfo?.map((theme) => {
        if (theme?.mode?.toLowerCase() === 'light') {
            lightModeTheme = theme
        }
        if (theme?.mode?.toLowerCase() === 'dark') {
            darkModeTheme = theme
        }
    })
}

const cssFileString = `${lightModeTheme?.font?.import_url ? `@import url('${lightModeTheme?.font?.import_url}');` : ''}
${darkModeTheme?.font?.import_url ? `@import url('${darkModeTheme?.font?.import_url}');` : ''}
/**
* Any CSS included here will be global. The classic template
* bundles Infima by default. Infima is a CSS framework designed to
* work well for content-centric websites.
*/

/* You can override the default Infima variables here. */
:root {
   --ifm-color-primary: ${lightModeTheme?.primary_color ? lightModeTheme?.primary_color : '#2e8555'};
   --ifm-code-font-size: 95%;
   --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.1);
   ${
       lightModeTheme?.font?.font_family
           ? `--ifm-font-family-base: ${lightModeTheme?.font?.font_family} !important;
   --ifm-font-family-monospace: ${lightModeTheme?.font?.font_family} !important;`
           : ''
   }
   --highlight-text-color: ${lightModeTheme?.highlight?.text_color ? lightModeTheme?.highlight?.text_color : '#FFFFFF'} !important;
   --highlight-background-color: ${lightModeTheme?.highlight?.background_color ? lightModeTheme?.highlight?.background_color : '#0074ffcc'} !important;
   --font-weight: ${lightModeTheme?.font?.font_weight ? lightModeTheme?.font?.font_weight : '400'} !important;
   --text-color: ${lightModeTheme?.text_color ? lightModeTheme?.text_color : '#1C1E21'} !important;
   --ifm-navbar-background-color: ${lightModeTheme?.background_color?.header ? lightModeTheme?.background_color?.header : '#FFFFFF'} !important;
    --aa-input-background-color-rgb: ${lightModeTheme?.background_color?.header ? lightModeTheme?.background_color?.header : '#FFFFFF'} !important;
   --footer-background-color: ${lightModeTheme?.background_color?.footer ? lightModeTheme?.background_color?.footer : '#23303D'} !important;
   --sidebar-background-color: ${lightModeTheme?.background_color?.sidebar ? lightModeTheme?.background_color?.sidebar : '#FFFFFF'} !important;
   --docusaurus-collapse-button-bg: var(--sidebar-background-color) !important;
   --background-color: ${lightModeTheme?.background_color?.body ? lightModeTheme?.background_color?.body : '#FFFFFF'} !important;
   --ifm-card-background-color: ${lightModeTheme?.secondary_color ? lightModeTheme?.secondary_color : '#F5F6F7'} !important;
   --openapi-card-background-color: var(--ifm-card-background-color) !important;
   --ifm-code-background: var(--ifm-card-background-color) !important;
   --ifm-color-emphasis-100: var(--ifm-card-background-color);
}

/* For readability concerns, you should choose a lighter palette in dark mode. */
[data-theme='dark'] {
   --ifm-color-primary: ${darkModeTheme?.primary_color ? darkModeTheme?.primary_color : '#BE844A'};
   --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.3);
   ${
       darkModeTheme?.font?.font_family
           ? `--ifm-font-family-base: ${darkModeTheme?.font?.font_family} !important;
    --ifm-font-family-monospace: ${darkModeTheme?.font?.font_family} !important;`
           : ''
   }
   --highlight-text-color: ${darkModeTheme?.highlight?.text_color ? darkModeTheme?.highlight?.text_color : '#FFFFFF'} !important;
   --highlight-background-color: ${darkModeTheme?.highlight?.background_color ? darkModeTheme?.highlight?.background_color : '#0074ffcc'} !important;
   --font-weight: ${darkModeTheme?.font?.font_weight ? darkModeTheme?.font?.font_weight : '400'} !important;
   --text-color: ${darkModeTheme?.text_color ? darkModeTheme?.text_color : 'E3E3E3'} !important;
   --ifm-navbar-background-color: ${darkModeTheme?.background_color?.header ? darkModeTheme?.background_color?.header : '#23303D'} !important;
    --aa-input-background-color-rgb: ${darkModeTheme?.background_color?.header ? darkModeTheme?.background_color?.header : '#141c22'} !important;
   --footer-background-color: ${darkModeTheme?.background_color?.footer ? darkModeTheme?.background_color?.footer : '#23303D'} !important;
   --sidebar-background-color: ${darkModeTheme?.background_color?.sidebar ? darkModeTheme?.background_color?.sidebar : '#1c262f'} !important;
   --docusaurus-collapse-button-bg: var(--sidebar-background-color) !important;
   --background-color: ${darkModeTheme?.background_color?.body ? darkModeTheme?.background_color?.body : '#141c22'} !important;
   --ifm-card-background-color: ${darkModeTheme?.secondary_color ? darkModeTheme?.secondary_color : '#23303D'} !important;
   --openapi-card-background-color: var(--ifm-card-background-color) !important;
   --ifm-code-background: var(--ifm-card-background-color) !important;
   --ifm-color-emphasis-100: var(--ifm-card-background-color);
}

::selection {
    color: var(--highlight-text-color) !important;
    background-color: var(--highlight-background-color) !important;
}

::-moz-selection {
    color: var(--highlight-text-color) !important;
    background-color: var(--highlight-background-color) !important;
}

#__docusaurus {
    font-weight: var(--font-weight) !important;
    background-color: var(--background-color) !important;
    color: var(--text-color) !important;
}

/* Sidebar Method labels */
.api-method > .menu__link {
    align-items: center;
    justify-content: start;
}

.api-method > .menu__link::before {
    width: 50px;
    height: 20px;
    font-size: 12px;
    line-height: 20px;
    text-transform: uppercase;
    font-weight: 600;
    border-radius: 0.25rem;
    border: 1px solid;
    margin-right: var(--ifm-spacing-horizontal);
    text-align: center;
    flex-shrink: 0;
    border-color: transparent;
    color: white;
}

.get > .menu__link::before {
    content: 'get';
    background-color: #61affe;
}

.put > .menu__link::before {
    content: 'put';
    background-color: #fca130;
}

.post > .menu__link::before {
    content: 'post';
    background-color: #49cc90;
}

.delete > .menu__link::before {
    content: 'del';
    background-color: #f93e3e;
}

.patch > .menu__link::before {
    content: 'patch';
    background-color: #50e3c2;
}

.logout-btn {
    padding: 8px;
    font-weight: 500;
    width: 96px;
    background: inherit !important;
    font-family: inherit !important;
    border: none;
    font-size: 16px;
    cursor: pointer;
}

.logout-btn:hover {
    color: var(--ifm-color-primary);
    text-decoration: none !important;
}

.navbar__brand {
    margin-right: 16px !important;
    display: flex;
    align-items: center;
    gap: 10px;
}

.navbar__logo {
    height: 32px !important;
    width: auto !important;
    flex: 0 0 auto !important;
    margin-right: 0 !important;
}

.navbar__logo img {
    display: block;
    backface-visibility: hidden;
    transform: translateZ(0);
}

.ant-collapse {
    font-family: var(--ifm-font-family-base);
}

.ant-checkbox-wrapper {
    font-family: var(--ifm-font-family-base);
}

.menu {
    background-color: var(--sidebar-background-color) !important;
}

.theme-doc-sidebar-menu {
    padding-top: 1rem !important;
}
 
 .codeBlockTitle_node_modules-\\@docusaurus-theme-classic-lib-theme-CodeBlock-Content-styles-module {
    background-color: var(--ifm-code-background) !important;
}
 
 .codeBlockLines_node_modules-\\@docusaurus-theme-classic-lib-theme-CodeBlock-Content-styles-module {
     background-color: var(--ifm-code-background) !important;
}
 
 .code__tab--bash.tabs__item--active {
     background-color: var(--ifm-code-background) !important;
}
 
 .footer {
     background-color: var(--footer-background-color) !important;
}

.ant-collapse-header {
    background-color: var(--ifm-card-background-color) !important;
}

.onedoc-powered-wrapper {
    padding: 15px 0;
    text-align: center;
    background-color: #292b2d;
    color: #ffffff;
    font-weight: 500;
}

/* Navbar icon-only links */
.navbar__item.navbar__link.header-github-link,
.navbar__item.navbar__link.header-discord-link,
.navbar__item.navbar__link.header-npm-link {
    padding: 0 !important;
    width: 32px;
    height: 32px;
    display: flex !important;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
}

.navbar__item.navbar__link.header-github-link::before,
.navbar__item.navbar__link.header-discord-link::before,
.navbar__item.navbar__link.header-npm-link::before {
    content: '';
    width: 24px;
    height: 24px;
    display: block;
    background-repeat: no-repeat;
    background-size: contain;
    background-position: center;
}

.navbar__item.navbar__link.header-github-link::before {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23ffffff' d='M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'/%3E%3C/svg%3E");
}

[data-theme='light'] .navbar__item.navbar__link.header-github-link::before {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23000000' d='M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'/%3E%3C/svg%3E");
}

.navbar__item.navbar__link.header-discord-link::before {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23ffffff' d='M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'/%3E%3C/svg%3E");
}

[data-theme='light'] .navbar__item.navbar__link.header-discord-link::before {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%235865F2' d='M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'/%3E%3C/svg%3E");
}

.navbar__item.navbar__link.header-npm-link::before {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='32' height='32' rx='6' fill='%23CB3837'/%3E%3Cpath fill='%23ffffff' d='M8 10h16v12h-8v-8h-4v8H8V10zm10 4v4h2v-4h-2z'/%3E%3C/svg%3E");
}

.footer a[href*='npmjs.com/package/catalyst-core']::before {
    content: '';
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 6px;
    vertical-align: -2px;
    background-repeat: no-repeat;
    background-size: contain;
    background-position: center;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='32' height='32' rx='6' fill='%23CB3837'/%3E%3Cpath fill='%23ffffff' d='M8 10h16v12h-8v-8h-4v8H8V10zm10 4v4h2v-4h-2z'/%3E%3C/svg%3E");
}

.navbar__item.navbar__link.header-github-link:hover,
.navbar__item.navbar__link.header-discord-link:hover,
.navbar__item.navbar__link.header-npm-link:hover {
    opacity: 0.7;
}

/* ========================================
   NAVBAR - SEAMLESS BLEND
   ======================================== */

.navbar {
    box-shadow: none !important;
    border-bottom: none !important;
    background-color: var(--ifm-navbar-background-color) !important;
}

[data-theme='dark'] .navbar {
    box-shadow: none !important;
    border-bottom: none !important;
    background-color: var(--ifm-navbar-background-color) !important;
}

.navbar-sidebar__items {
    background: var(--ifm-navbar-background-color) !important;
}

.navbar-sidebar__backdrop {
    background: rgba(15, 23, 42, 0.42) !important;
}

[data-theme='dark'] .navbar-sidebar__backdrop {
    background: rgba(2, 6, 23, 0.62) !important;
}

@media (max-width: 996px) {
    .navbar-sidebar {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        width: min(84vw, 420px) !important;
        max-width: 100% !important;
        transform: translate3d(-100%, 0, 0);
        transition: transform var(--ifm-transition-fast) ease;
        background: var(--ifm-navbar-background-color) !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
        overflow: hidden;
        opacity: 0 !important;
        visibility: hidden !important;
    }

    .navbar-sidebar__items {
        position: relative;
        height: calc(100% - 58px);
        width: 200%;
        overflow-x: hidden;
        overflow-y: auto;
        transition: transform var(--ifm-transition-fast) ease;
    }

    .navbar-sidebar__item {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 50%;
        padding: 0.5rem 0.75rem 1rem;
        box-sizing: border-box;
    }

    .navbar-sidebar__item:last-child {
        left: 50%;
    }

    .navbar-sidebar__items--show-secondary {
        transform: translate3d(-50%, 0, 0);
    }

    .navbar-sidebar__back {
        display: none !important;
    }

    .navbar-sidebar--show .navbar-sidebar {
        transform: translate3d(0, 0, 0);
        opacity: 1 !important;
        visibility: visible !important;
    }

    .navbar-sidebar__backdrop {
        position: fixed !important;
        inset: 0 !important;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity var(--ifm-transition-fast) ease;
    }

    .navbar-sidebar--show .navbar-sidebar__backdrop {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
    }

    .navbar.navbar-sidebar--show {
        transform: none !important;
    }
}
`
const fileName = 'custom.css'
const cssFilePath = path.resolve(__dirname, `../src/css/${fileName}`)

try {
    fs.writeFileSync(cssFilePath, cssFileString, 'utf-8')
} catch (error) {
    console.log(error)
}
