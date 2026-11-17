import React from "react"
import { Head, Body } from "catalyst-core"

// Runs before React exists. It remembers what the user types into any element marked data-early, so hydration can restore it.
// PREHYDRATE: it also filters the server-rendered cards (li[data-name]) straight away, so search works before any JS bundle has loaded.
const PREHYDRATE = false
const EARLY = `(function(){var E=window.__early={};function apply(){var q=(E.q||"").trim().toLowerCase(),t=E.type||"",it=document.querySelectorAll("li[data-name]");for(var i=0;i<it.length;i++){var li=it[i];li.hidden=!(li.getAttribute("data-name").indexOf(q)>-1&&(!t||(" "+li.getAttribute("data-types")+" ").indexOf(" "+t+" ")>-1))}}function on(e){var t=e.target;if(t&&t.getAttribute){var k=t.getAttribute("data-early");if(k){E[k]=t.value;if(PRE&&!window.__hydrated)apply()}}}document.addEventListener("input",on,true);document.addEventListener("change",on,true)})()`.replace("PRE", PREHYDRATE ? "true" : "false")

function Document(props) {
    return (
        <html lang="en">
            <Head {...props}>
                <script dangerouslySetInnerHTML={{ __html: EARLY }} />
            </Head>
            <Body {...props} />
        </html>
    )
}

export default Document
