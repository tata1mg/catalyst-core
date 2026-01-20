/**
 * Chat Example Component
 * Demonstrates useDialogue hook
 */

import React from 'react';
import { useDialogue } from '../client/hooks/use-dialogue.js';
import './ChatExample.css';

export function ChatExample() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    stop,
    clear
  } = useDialogue({
    api: '/api/prompt',
    onFinish: (message) => {
      console.log('Chat finished:', message);
    },
    onError: (error) => {
      console.error('Chat error:', error);
    }
  });

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>AI Chat</h2>
        <button onClick={clear} className="clear-button">
          Clear Chat
        </button>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with the AI</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role}`}
          >
            <div className="message-role">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              {message.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message assistant loading">
            <div className="message-role">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <span>⚠️ {error.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="chat-form">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          disabled={isLoading}
          className="chat-input"
        />
        
        <div className="chat-actions">
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="stop-button"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="send-button"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default ChatExample;