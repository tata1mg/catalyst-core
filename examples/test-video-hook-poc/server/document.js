import React from "react"
import { Head, Body } from "catalyst-core"

function Document(props) {
    return (
        <html lang="en">
            <Head {...props}>
                <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
                <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" />
            </Head>
            <Body {...props} />
        </html>
    )
}
export default Document
