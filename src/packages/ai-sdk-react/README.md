# @catalyst/ai-sdk-react

React hooks and state management for AI SDK - Build AI-powered applications with React.

## Installation

```bash
npm install @catalyst/ai-sdk @catalyst/ai-sdk-react
```

## Features

- 🎣 **React Hooks** - useDialogue and usePrompt for easy integration
- 🌊 **Streaming Support** - Real-time text generation with streaming responses
- 📦 **State Management** - Built-in state management with reducers
- 🔄 **Automatic Updates** - UI updates automatically as text streams in
- 🎯 **TypeScript Ready** - Full TypeScript support (coming soon)
- 🚀 **Framework Agnostic Core** - Uses @catalyst/ai-sdk/core for core functionality

## Quick Start

### Chat Interface with useDialogue

```jsx
import { useDialogue } from '@catalyst/ai-sdk-react';

function ChatComponent() {
  const { 
    messages, 
    input, 
    isLoading, 
    sendMessage, 
    handleInputChange, 
    handleSubmit 
  } = useDialogue({
    api: '/api/dialogue',
    stream: true
  });

  return (
    <div>
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <form onSubmit={handleSubmit}>
        <input 
          value={input} 
          onChange={handleInputChange}
          disabled={isLoading}
          placeholder="Type your message..."
        />
        <button type="submit" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
}
```

### Text Completion with usePrompt

```jsx
import { usePrompt } from '@catalyst/ai-sdk-react';

function CompletionComponent() {
  const { 
    completion, 
    complete, 
    isLoading 
  } = usePrompt({
    api: '/api/prompt',
    stream: true
  });

  return (
    <div>
      <button 
        onClick={() => complete("Write a haiku about coding")}
        disabled={isLoading}
      >
        Generate
      </button>
      
      <div className="completion">
        {completion}
      </div>
    </div>
  );
}
```

## Hooks API

### useDialogue(options)

Hook for managing chat conversations with streaming support.

**Options:**
- `api` - API endpoint (default: '/api/dialogue')
- `initialMessages` - Initial message history
- `stream` - Enable streaming (default: true)
- `onFinish` - Callback when response finishes
- `onError` - Error callback
- `headers` - Additional HTTP headers
- `body` - Additional request body parameters

**Returns:**
- `messages` - Array of message objects
- `input` - Current input value
- `isLoading` - Loading state
- `error` - Error object if any
- `sendMessage(content)` - Send a message
- `append(message)` - Manually add a message
- `reload()` - Regenerate last response
- `stop()` - Stop current generation
- `clear()` - Clear all messages
- `setMessages(messages)` - Set message history
- `handleInputChange(e)` - Input change handler
- `handleSubmit(e)` - Form submit handler

### usePrompt(options)

Hook for text completion with streaming support.

**Options:**
- `api` - API endpoint (default: '/api/prompt')
- `initialCompletion` - Initial completion text
- `stream` - Enable streaming (default: true)
- `onFinish` - Callback when completion finishes
- `onError` - Error callback
- `onResponse` - Callback when response starts
- `headers` - Additional HTTP headers
- `body` - Additional request body parameters

**Returns:**
- `completion` - Generated text
- `input` - Current input value
- `isLoading` - Loading state
- `error` - Error object if any
- `complete(prompt)` - Generate completion
- `stop()` - Stop current generation
- `clear()` - Clear completion
- `reload()` - Retry last prompt
- `setCompletion(text)` - Set completion manually
- `handleInputChange(e)` - Input change handler
- `handleSubmit(e)` - Form submit handler

## State Management Utilities

This package also exports state management utilities:

```javascript
import {
  createInitialChatState,
  createInitialCompletionState,
  CHAT_ACTIONS,
  COMPLETION_ACTIONS,
  chatReducer,
  completionReducer,
  generateId,
  createMessage,
  validateMessage
} from '@catalyst/ai-sdk-react';
```

## Server Setup

You need to set up server endpoints. See [@catalyst/ai-sdk](../ai-sdk) for server setup:

```javascript
import { handleDialogue, handlePrompt } from '@catalyst/ai-sdk/server';

// Express.js example
app.post('/api/dialogue', handleDialogue);
app.post('/api/prompt', handlePrompt);
```

## Architecture

- **@catalyst/ai-sdk-react** - React hooks and state management (this package)
- **@catalyst/ai-sdk/core** - Core utilities (stream processing, HTTP client)
- **@catalyst/ai-sdk/server** - Server-side handlers
- **@catalyst/ai-sdk/client** - Client-side utilities (no React dependency)

## License

MIT