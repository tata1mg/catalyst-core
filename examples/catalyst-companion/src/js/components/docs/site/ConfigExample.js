import React from "react"
import CodeBlock from "../CodeBlock"
import { configExamples } from "./data/configExamples"

/**
 * Port of the docs site's ConfigExample: renders a named config example as a
 * titled JSON code block. Same props contract (`type`, `title`) and the same
 * throw on unknown types.
 */
const ConfigExample = ({ type = "appConfig", title = "config/config.json" }) => {
    const example = configExamples[type]
    if (!example) {
        throw new Error(`Unknown config example: ${type}`)
    }

    return (
        <div className="doc-codeblock-titled">
            <div className="doc-codeblock-title">{title}</div>
            <CodeBlock className="language-json">{JSON.stringify(example, null, 2)}</CodeBlock>
        </div>
    )
}

export default ConfigExample
