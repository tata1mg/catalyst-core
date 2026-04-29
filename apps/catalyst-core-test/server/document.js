import React from "react"
import { Head, Body } from "catalyst-core"

function Document(props) {
    return (
        <html lang="en">
            <Head {...props}>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;700&display=swap"
                    rel="stylesheet"
                />
            </Head>
            <Body {...props} />
        </html>
    )
}

export default Document
