import React from "react"

const FastRefresh = ({ nonce }) => {
    return (
        <script
            type="module"
            nonce={nonce}
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
