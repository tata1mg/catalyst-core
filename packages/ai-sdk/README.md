# @catalyst/ai-sdk

A lightweight AI SDK for building LLM-powered applications with streaming support. Works with OpenAI and Anthropic providers.

> **Note:** For React hooks, see [@catalyst/ai-sdk-react](../ai-sdk-react)

## Features

🌊 **Streaming Support** - Real-time text streaming with SSE  
🔌 **Multiple Providers** - OpenAI and Anthropic support  
⚡ **Lightweight** - Minimal dependencies, framework-agnostic core  
🎯 **Type-Safe** - Built with modern JavaScript/ES modules  
🔧 **Flexible** - Works with any Express server or custom backend  
📦 **Modular** - Use only what you need (client, server, or core)

## Installation

```bash
npm install @catalyst/ai-sdk
```

For React applications:
```bash
npm install @catalyst/ai-sdk @catalyst/ai-sdk-react
```

## Package Structure

- **@catalyst/ai-sdk** - Main entry (client functions)
- **@catalyst/ai-sdk/client** - Client-side utilities (textGenerate, textStream)
- **@catalyst/ai-sdk/server** - Server-side handlers and providers
- **@catalyst/ai-sdk/core** - Core utilities (stream processing, HTTP client, rate limiter)

## Quick Start

### 1. Server Setup

Set up your backend to handle AI requests:

```javascript
import express from 'express';
import { handleDialogue, handlePrompt } from '@catalyst/ai-sdk/server';

const app = express();
app.use(express.json());

// Chat endpoint (conversational AI)
app.post('/api/dialogue', handleDialogue);

// Completion endpoint (text generation)
app.post('/api/prompt', handlePrompt);

app.listen(3000);
```

Configure your AI provider with environment variables:

```bash
# .env
OPENAI_API_KEY=your-openai-key
# or
ANTHROPIC_API_KEY=your-anthropic-key
```

### 2. Client Usage (Vanilla JavaScript)

```javascript
import { textStream, textGenerate } from '@catalyst/ai-sdk';

// Streaming text generation
const handleStream = async () => {
  const response = await textStream('/api/prompt', {
    prompt: 'Write a haiku about coding',
    stream: true
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    console.log(chunk); // Process each chunk
  }
};

// Non-streaming generation
const result = await textGenerate('/api/prompt', {
  prompt: 'Explain recursion',
  stream: false
});
console.log(result.text);
```

### 3. React Usage

For React applications, use the dedicated React package:

```javascript
import { usePrompt, useDialogue } from '@catalyst/ai-sdk-react';

function MyComponent() {
  const { completion, complete, isLoading } = usePrompt({
    api: '/api/prompt'
  });

  return (
    <div>
      <button onClick={() => complete('Hello AI!')}>
        Generate
      </button>
      <p>{completion}</p>
    </div>
  );
}
```

See [@catalyst/ai-sdk-react documentation](../ai-sdk-react) for more details.

## API Reference

### Client Functions

#### textStream(url, options)

Stream text generation from the server.

```javascript
import { textStream } from '@catalyst/ai-sdk';

const response = await textStream('/api/prompt', {
  prompt: 'Your prompt here',
  stream: true,
  // Optional:
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 500
});
```

#### textGenerate(url, options)

Non-streaming text generation.

```javascript
import { textGenerate } from '@catalyst/ai-sdk';

const result = await textGenerate('/api/prompt', {
  prompt: 'Your prompt here',
  stream: false
});
console.log(result.text);
```

#### textStreamWithMessages(url, options)

Stream chat conversations with message history.

```javascript
import { textStreamWithMessages } from '@catalyst/ai-sdk';

const response = await textStreamWithMessages('/api/dialogue', {
  messages: [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi! How can I help?' },
    { role: 'user', content: 'Tell me a joke' }
  ],
  stream: true
});
```

### Server Handlers

#### handleDialogue(req, res)

Express handler for chat conversations.

```javascript
import { handleDialogue } from '@catalyst/ai-sdk/server';

app.post('/api/dialogue', handleDialogue);
```

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "model": "gpt-4",
  "temperature": 0.7
}
```

#### handlePrompt(req, res)

Express handler for text completion.

```javascript
import { handlePrompt } from '@catalyst/ai-sdk/server';

app.post('/api/prompt', handlePrompt);
```

**Request Body:**
```json
{
  "prompt": "Write a haiku",
  "stream": true,
  "model": "gpt-4",
  "temperature": 0.7,
  "maxTokens": 500
}
```

### Core Utilities

Access core utilities for advanced use cases:

```javascript
import {
  processTextStream,
  makeRequest,
  createAbortController,
  RateLimiter
} from '@catalyst/ai-sdk/core';

// Process SSE streams
await processTextStream(response.body, {
  onChunk: (chunk) => console.log(chunk),
  onComplete: (fullText) => console.log('Done:', fullText),
  onError: (error) => console.error(error)
});

// Make HTTP requests with proper error handling
const response = await makeRequest('/api/endpoint', {
  method: 'POST',
  body: { data: 'value' }
});

// Rate limiting
const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });
```

## Configuration

### Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4  # Optional, defaults to gpt-3.5-turbo

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-opus-20240229  # Optional

# General
AI_PROVIDER=openai  # or 'anthropic'
```

### Provider Selection

The SDK automatically selects the provider based on available API keys:

1. If `OPENAI_API_KEY` is set → uses OpenAI
2. If `ANTHROPIC_API_KEY` is set → uses Anthropic
3. Set `AI_PROVIDER` env variable to force a specific provider

## Examples

### Basic Server

```javascript
import express from 'express';
import { handleDialogue, handlePrompt } from '@catalyst/ai-sdk/server';

const app = express();
app.use(express.json());

app.post('/api/dialogue', handleDialogue);
app.post('/api/prompt', handlePrompt);

app.listen(3000, () => {
  console.log('AI Server running on port 3000');
});
```

### Custom Provider Configuration

```javascript
import { createAPIHandler, openai } from '@catalyst/ai-sdk/server';

const handler = createAPIHandler({
  provider: openai,
  model: 'gpt-4',
  temperature: 0.8,
  maxTokens: 1000
});

app.post('/api/custom', handler);
```

### Error Handling

```javascript
import { textGenerate } from '@catalyst/ai-sdk';

try {
  const result = await textGenerate('/api/prompt', {
    prompt: 'Hello'
  });
  console.log(result.text);
} catch (error) {
  if (error.status === 429) {
    console.error('Rate limit exceeded');
  } else if (error.status === 500) {
    console.error('Server error:', error.message);
  } else {
    console.error('Request failed:', error);
  }
}
```

## Architecture

```
@catalyst/ai-sdk
├── /client          → Client-side functions (browser)
├── /server          → Server-side handlers (Node.js)
└── /core            → Core utilities (both environments)

@catalyst/ai-sdk-react (separate package)
├── /hooks           → React hooks (usePrompt, useDialogue)
└── /state-manager   → React state management
```

## Related Packages

- **[@catalyst/ai-sdk-react](../ai-sdk-react)** - React hooks and state management
- **@catalyst/ai-sdk/server** - Server-side handlers (included)
- **@catalyst/ai-sdk/core** - Core utilities (included)

## Migration from v0.x

If you were using React hooks from `@catalyst/ai-sdk`:

```javascript
// Old (v0.x)
import { usePrompt, useDialogue } from '@catalyst/ai-sdk';

// New (v1.x)
import { usePrompt, useDialogue } from '@catalyst/ai-sdk-react';
```

Client and server functions remain unchanged.

## License

MIT

## Contributing

Contributions welcome! Please see the main [catalyst-core repository](https://github.com/tata1mg/catalyst-core).