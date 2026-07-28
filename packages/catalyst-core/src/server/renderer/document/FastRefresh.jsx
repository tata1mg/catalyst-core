import React from "react"

/* eslint-disable risxss/catch-potential-xss-react */
const FastRefresh = () => {
    return (
        <script
            type="module"
            dangerouslySetInnerHTML={{
                __html: `
        import { injectIntoGlobalHook } from "/@react-refresh";
        injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        `,
            }}
        />
    )
}

export default FastRefresh
