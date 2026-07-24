import React from "react"

/**
 * Blocking inline script rendered before any visible content by every layout
 * root (HubLayout, AppHome, NotFound). Runs pre-paint so the first frame is
 * already correct:
 *
 *  - data-theme: stored theme (SSR can't know localStorage; waiting for
 *    hydration causes a light-mode flash).
 *  - data-shell: "app" inside a Catalyst native shell (the bridge objects are
 *    injected before page load on both platforms), else "web". CSS shows
 *    .shell-only / hides .web-only under html[data-shell="app"]; with no JS
 *    the site safely renders the web variant.
 */
const THEME_STORAGE_KEY = "catalyst-hub.theme"

const BOOTSTRAP_SNIPPET = `(function(){var t="dark";try{var s=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
)});if(s==="light"||s==="dark")t=s}catch(e){}var d=document.documentElement;d.setAttribute("data-theme",t);var shell=!!(window.PluginBridge||(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.PluginBridge));d.setAttribute("data-shell",shell?"app":"web")})()`

const DocumentBootstrap = () => <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SNIPPET }} />

export { THEME_STORAGE_KEY }
export default DocumentBootstrap
