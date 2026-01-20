/**
 * Example Server Setup
 * Demonstrates how to set up API endpoints using the AI SDK
 */

// Example using Express.js
// npm install express

const express = require('express');
const { createAPIHandler, createChatHandler, createCompletionHandler } = require('../index.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ==========================================
// OPTION 1: Simple API Handler
// ==========================================

app.post('/api/generate', createAPIHandler({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-3.5-turbo'
}));

// ==========================================
// OPTION 2: Chat Handler (with streaming)
// ==========================================

app.post('/api/prompt', createChatHandler({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 1000
}));

// ==========================================
// OPTION 3: Completion Handler
// ==========================================

app.post('/api/dialogue', createCompletionHandler({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-3.5-turbo'
}));

// ==========================================
// OPTION 4: Custom Handler with Multiple Providers
// ==========================================

app.post('/api/ai', async (req, res) => {
  const { provider } = req.body;
  
  // Select API key based on provider
  const apiKey = provider === 'anthropic' 
    ? process.env.ANTHROPIC_API_KEY 
    : process.env.OPENAI_API_KEY;

  const handler = createAPIHandler({
    provider: provider || 'openai',
    apiKey
  });

  return handler(req, res);
});

// ==========================================
// OPTION 5: Manual Implementation
// ==========================================

const { openaiProvider, anthropicProvider } = require('../index.js');

app.post('/api/custom', async (req, res) => {
  try {
    const { prompt, provider = 'openai', stream = false } = req.body;

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const selectedProvider = provider === 'anthropic' ? anthropicProvider : openaiProvider;
      
      const streamBody = await selectedProvider.textStream({
        apiKey: provider === 'anthropic' 
          ? process.env.ANTHROPIC_API_KEY 
          : process.env.OPENAI_API_KEY,
        prompt,
        model: provider === 'anthropic' ? 'claude-3-sonnet-20240229' : 'gpt-3.5-turbo'
      });

      const reader = streamBody.getReader();
      const processor = selectedProvider.createStreamProcessor();

      for await (const chunk of processor.processStream(reader)) {
        if (chunk.type === 'text-delta') {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }

      res.end();
    } else {
      // Non-streaming response
      const selectedProvider = provider === 'anthropic' ? anthropicProvider : openaiProvider;
      
      const result = await selectedProvider.textGenerate({
        apiKey: provider === 'anthropic' 
          ? process.env.ANTHROPIC_API_KEY 
          : process.env.OPENAI_API_KEY,
        prompt,
        model: provider === 'anthropic' ? 'claude-3-sonnet-20240229' : 'gpt-3.5-turbo'
      });

      res.json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Start Server
// ==========================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// ==========================================
// Example with Node.js HTTP (no Express)
// ==========================================

/*
const http = require('http');
const { createAPIHandler } = require('../index.js');

const handler = createAPIHandler({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY
});

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      req.body = JSON.parse(body);
      handler(req, res);
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3000);
*/