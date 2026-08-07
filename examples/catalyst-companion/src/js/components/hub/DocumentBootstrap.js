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
 *
 * This snippet only runs once, at parse time. Exiting a preview rebuilds the
 * native WebView, and the bridge handlers are re-registered on that fresh
 * instance — so the page can parse before they exist and latch "web", hiding
 * the whole shell UI. `applyShellAttribute` re-asserts it after bridge init.
 */
const THEME_STORAGE_KEY = "catalyst-hub.theme"

const SHELL_TEST = `!!(window.PluginBridge||(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.PluginBridge))`

const BOOTSTRAP_SNIPPET = `(function(){var t="dark";try{var s=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
)});if(s==="light"||s==="dark")t=s}catch(e){}var d=document.documentElement;d.setAttribute("data-theme",t);var shell=${SHELL_TEST};d.setAttribute("data-shell",shell?"app":"web")})()`

const isNativeShell = () =>
    typeof window !== "undefined" &&
    !!(window.PluginBridge || window.webkit?.messageHandlers?.PluginBridge)

/**
 * Re-runs the shell check and updates data-shell. Only ever upgrades "web" to
 * "app" — never the reverse, so a transient miss can't blank a working shell.
 */
const applyShellAttribute = () => {
    if (typeof document === "undefined") return
    if (!isNativeShell()) return
    document.documentElement.setAttribute("data-shell", "app")
}

const DocumentBootstrap = () => <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SNIPPET }} />

export { THEME_STORAGE_KEY, isNativeShell, applyShellAttribute }
export default DocumentBootstrap
