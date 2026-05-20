import React from 'react'
import CodeBlock from '@theme/CodeBlock'
import { configExamples } from '@site/src/data/configExamples'

export default function ConfigExample({
    type = 'appConfig',
    title = 'config/config.json',
}) {
    const example = configExamples[type]

    if (!example) {
        throw new Error(`Unknown config example: ${type}`)
    }

    return (
        <CodeBlock language="json" title={title}>
            {JSON.stringify(example, null, 2)}
        </CodeBlock>
    )
}
