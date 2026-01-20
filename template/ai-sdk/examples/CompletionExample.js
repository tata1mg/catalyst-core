/**
 * Completion Example Component
 * Demonstrates usePrompt hook
 */

import React from 'react';
import { usePrompt } from '../client/hooks/use-prompt.js';
import './CompletionExample.css';

export function CompletionExample() {
  const {
    completion,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    stop,
    clear
  } = usePrompt({
    api: '/api/dialogue',
    onFinish: (prompt, completion) => {
      console.log('Completion finished:', { prompt, completion });
    },
    onError: (error) => {
      console.error('Completion error:', error);
    }
  });

  return (
    <div className="completion-container">
      <div className="completion-header">
        <h2>AI Text Completion</h2>
        <button onClick={clear} className="clear-button">
          Clear
        </button>
      </div>

      <form onSubmit={handleSubmit} className="completion-form">
        <div className="input-section">
          <label htmlFor="prompt">Enter your prompt:</label>
          <textarea
            id="prompt"
            value={input}
            onChange={handleInputChange}
            placeholder="Write a short story about..."
            disabled={isLoading}
            className="prompt-input"
            rows={4}
          />
        </div>

        <div className="form-actions">
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="stop-button"
            >
              Stop Generation
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="generate-button"
            >
              Generate
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="error-banner">
          <span>⚠️ {error.message}</span>
        </div>
      )}

      {(completion || isLoading) && (
        <div className="completion-output">
          <h3>Generated Text:</h3>
          <div className="completion-text">
            {completion}
            {isLoading && (
              <span className="cursor">|</span>
            )}
          </div>
        </div>
      )}

      {!completion && !isLoading && (
        <div className="empty-state">
          <p>Enter a prompt above to generate text</p>
        </div>
      )}
    </div>
  );
}

export default CompletionExample;