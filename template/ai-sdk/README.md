# AI SDK - React Implementation

A clean, simple AI SDK , built with React.

## Features

- \u2705 Text Generation (textGenerate)
- \u2705 Text Streaming (textStream)
- \u2705 React Hooks (useDialogue, usePrompt)
- \u2705 Server-side API handlers
- \u2705 Multiple LLM provider support (OpenAI, Anthropic, etc.)
- \u2705 Clean separation: Client => Server => LLM

## Folder Structure

```
ai-sdk/
\u251c\u2500\u2500 client/              # Client-side code
\u2502   \u251c\u2500\u2500 text-generate.js
\u2502   \u251c\u2500\u2500 text-stream.js
\u2502   \u2514\u2500\u2500 hooks/
\u2502       \u251c\u2500\u2500 use-dialogue.js
\u2502       \u2514\u2500\u2500 use-prompt.js
\u251c\u2500\u2500 server/              # Server-side code
\u2502   \u251c\u2500\u2500 api-handler.js
\u2502   \u2514\u2500\u2500 providers/
\u2502       \u251c\u2500\u2500 openai.js
\u2502       \u2514\u2500\u2500 anthropic.js
\u251c\u2500\u2500 core/                # Core utilities
\u2502   \u251c\u2500\u2500 stream-processor.js
\u2502   \u251c\u2500\u2500 http-client.js
\u2502   \u2514\u2500\u2500 state-manager.js
\u251c\u2500\u2500 examples/            # Example components
\u2502   \u251c\u2500\u2500 ChatExample.js
\u2502   \u2514\u2500\u2500 CompletionExample.js
\u2514\u2500\u2500 index.js             # Main exports
```

## Usage

### 1. Generate Text (Non-streaming)

```javascript
import { textGenerate } from './ai-sdk';

const result = await textGenerate({
  prompt: 'What is React?',
  model: 'gpt-3.5-turbo',
  apiKey: 'your-api-key'
});

console.log(result.text);
```

### 2. Stream Text

```javascript
import { textStream } from './ai-sdk';

const stream = textStream({
  prompt: 'Explain React hooks',
  onChunk: (chunk) => console.log(chunk),
  onComplete: (fullText) => console.log('Done:', fullText)
});

stream.start();
```

### 3. useDialogue Hook

```javascript
import { useDialogue } from './ai-sdk';

function ChatComponent() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useDialogue({
    api: '/api/prompt'
  });

  return (
    <div>
      <div>
        {messages.map(msg => (
          <div key={msg.id}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
```

### 4. usePrompt Hook

```javascript
import { usePrompt } from './ai-sdk';

function CompletionComponent() {
  const { completion, input, handleInputChange, handleSubmit, isLoading } = usePrompt({
    api: '/api/dialogue'
  });

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea value={input} onChange={handleInputChange} />
        <button disabled={isLoading}>Generate</button>
      </form>
      <div>{completion}</div>
    </div>
  );
}
```

## Server Setup

```javascript
// server.js
import { createAPIHandler } from './ai-sdk/server';

app.post('/api/prompt', createAPIHandler({
  provider: 'openai',
  model: 'gpt-3.5-turbo'
}));
```