import React from "react"
import { Head, Body } from "catalyst-core"

function Document(props) {
    return (
        <html lang="en">
            <Head {...props}></Head>
            <Body {...props} />
        </html>
    )
}
export default Document
