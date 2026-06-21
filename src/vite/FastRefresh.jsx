import React from "react"

const FastRefresh = () => {
    return (
        <script
            type="module"
            // eslint-disable-next-line risxss/catch-potential-xss-react
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
