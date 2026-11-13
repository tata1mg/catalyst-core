import React from "react"

const FastRefresh = ({ nonce }) => {
    return (
        <script
            type="module"
            nonce={nonce}
            // eslint-disable-next-line risxss/catch-potential-xss-react
            dangerouslySetInnerHTML={{
                // Base-prefixed so the preamble resolves under a sub-path; otherwise
                // plugin-react modules throw "$RefreshSig$ is not defined".
                __html: `
        import { injectIntoGlobalHook } from "${process.env.APP_MOUNT_PATH || ""}/@react-refresh";
        injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        `,
            }}
        />
    )
}

export default FastRefresh
