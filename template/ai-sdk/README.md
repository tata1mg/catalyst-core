# @ai-sdk/core

A lightweight, React-focused AI SDK for building LLM-powered applications with streaming support. Works with OpenAI and Anthropic providers.

## Features

✨ **React Hooks** - `usePrompt` and `useDialogue` hooks for easy integration  
🌊 **Streaming Support** - Real-time text streaming with SSE  
🔌 **Multiple Providers** - OpenAI and Anthropic support  
⚡ **Lightweight** - Minimal dependencies, maximum performance  
🎯 **Type-Safe** - Built with modern JavaScript/ES modules  
🔧 **Flexible** - Works with any Express server or custom backend  

## Installation

### From NPM (once published)

```bash
npm install @ai-sdk/core
```

### Local Development

```bash
# Link the package locally
cd path/to/ai-sdk
npm link

# In your project
npm link @ai-sdk/core
```

### Using File Reference (for monorepos)

```json
{
  "dependencies": {
    "@ai-sdk/core": "file:../ai-sdk"
  }
}
```

## Quick Start

### 1. Server Setup

```javascript
import express from 'express'
import { createAPIHandler, openai } from '@ai-sdk/core/server'

const app = express()

// Create API handler with OpenAI
const handler = createAPIHandler({
  provider: openai,
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4'
})

app.post('/api/chat', handler)
app.listen(3000)
```

### 2. Client Usage with React Hooks

#### Using `usePrompt` Hook

```javascript
import React, { useState } from 'react'
import { usePrompt } from '@ai-sdk/core'

function ChatComponent() {
  const [input, setInput] = useState('')
  const { response, isLoading, error, sendPrompt } = usePrompt({
    endpoint: '/api/chat',
    stream: true
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    await sendPrompt(input)
    setInput('')
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
      {isLoading && <p>Thinking...</p>}
      {error && <p>Error: {error}</p>}
      {response && <p>{response}</p>}
    </div>
  )
}
```

#### Using `useDialogue` Hook

```javascript
import React, { useState } from 'react'
import { useDialogue } from '@ai-sdk/core'

function DialogueComponent() {
  const [input, setInput] = useState('')
  const { messages, isLoading, error, sendMessage } = useDialogue({
    endpoint: '/api/chat',
    stream: true
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    await sendMessage(input)
    setInput('')
  }

  return (
    <div>
      <div>
        {messages.map((msg, i) => (
          <div key={i}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
      {error && <p>Error: {error}</p>}
    </div>
  )
}
```

## Import Paths

The package provides multiple import paths for better tree-shaking:

```javascript
// Main entry (includes everything)
import { usePrompt, useDialogue, createAPIHandler } from '@ai-sdk/core'

// Client-only imports
import { usePrompt, useDialogue } from '@ai-sdk/core/client'
import { usePrompt, useDialogue } from '@ai-sdk/core/client/hooks'

// Server-only imports
import { createAPIHandler, openai, anthropic } from '@ai-sdk/core/server'

// Core utilities
import { processTextStream, makeRequest } from '@ai-sdk/core/core'
```

## API Reference

### Client Hooks

#### `usePrompt(options)`

Single prompt/response interaction.

**Options:**
- `endpoint` (string) - API endpoint URL
- `stream` (boolean) - Enable streaming (default: true)
- `onStart` (function) - Called when request starts
- `onComplete` (function) - Called when response completes
- `onError` (function) - Called on error

**Returns:**
- `response` (string) - The AI response
- `isLoading` (boolean) - Loading state
- `error` (string|null) - Error message if any
- `sendPrompt(prompt)` (function) - Send a prompt
- `abort()` (function) - Cancel the request

#### `useDialogue(options)`

Multi-turn conversation with message history.

**Options:**
- `endpoint` (string) - API endpoint URL
- `stream` (boolean) - Enable streaming (default: true)
- `initialMessages` (array) - Starting messages
- `onStart` (function) - Called when request starts
- `onComplete` (function) - Called when response completes
- `onError` (function) - Called on error

**Returns:**
- `messages` (array) - Conversation history
- `isLoading` (boolean) - Loading state
- `error` (string|null) - Error message if any
- `sendMessage(content)` (function) - Send a message
- `clearMessages()` (function) - Clear history
- `abort()` (function) - Cancel the request

### Server API

#### `createAPIHandler(config)`

Creates an Express middleware handler for AI requests.

**Config:**
- `provider` (object) - Provider module (openai/anthropic)
- `apiKey` (string) - API key for the provider
- `model` (string) - Model name
- `temperature` (number) - Optional temperature setting
- `maxTokens` (number) - Optional max tokens

#### Providers

```javascript
import { openai, anthropic } from '@ai-sdk/core/server'

// OpenAI
const openaiHandler = createAPIHandler({
  provider: openai,
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4'
})

// Anthropic
const anthropicHandler = createAPIHandler({
  provider: anthropic,
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-opus-20240229'
})
```

## Environment Variables

Create a `.env` file:

```bash
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

## Examples

Check out the `/examples` directory for full working examples:

- **PromptTester** - Single prompt/response testing
- **DialogueTester** - Multi-turn conversation testing

To run examples:

```bash
cd examples
npm install
npm start
```

## Development

```bash
# Install dependencies
npm install

# Run examples server
npm run dev

# Link for local development
npm link
```

## Package Structure

```
@ai-sdk/core/
├── index.js              # Main entry point
├── client/
│   ├── index.js          # Client exports
│   ├── text-generate.js  # Text generation
│   ├── text-stream.js    # Streaming
│   └── hooks/
│       ├── index.js
│       ├── use-prompt.js
│       └── use-dialogue.js
├── server/
│   ├── index.js          # Server exports
│   ├── api-handler.js    # Express handlers
│   └── providers/
│       ├── openai.js
│       └── anthropic.js
└── core/
    ├── index.js
    ├── http-client.js
    ├── stream-processor.js
    ├── state-manager.js
    └── rate-limiter.js
```

## Publishing

To publish to npm:

```bash
# Login to npm
npm login

# Publish the package
npm publish --access public
```

**Note:** Scoped packages (@ai-sdk/core) require `--access public` flag on first publish.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.