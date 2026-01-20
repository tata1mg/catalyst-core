/**
 * Simple Demo App
 * Shows both Chat and Completion examples
 */

import React, { useState } from 'react';
import { ChatExample } from './ChatExample.js';
import { CompletionExample } from './CompletionExample.js';
import './DemoApp.css';

export function DemoApp() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="demo-app">
      <header className="app-header">
        <h1>AI SDK v2 Demo</h1>
        <p>A simple AI SDK</p>
      </header>

      <div className="tab-navigation">
        <button
          className={activeTab === 'chat' ? 'active' : ''}
          onClick={() => setActiveTab('chat')}
        >
          Chat Example
        </button>
        <button
          className={activeTab === 'completion' ? 'active' : ''}
          onClick={() => setActiveTab('completion')}
        >
          Completion Example
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'chat' && <ChatExample />}
        {activeTab === 'completion' && <CompletionExample />}
      </div>

      <footer className="app-footer">
        <div className="features">
          <div className="feature">
            <span className="icon">✅</span>
            <span>Streaming Support</span>
          </div>
          <div className="feature">
            <span className="icon">⚡</span>
            <span>React Hooks</span>
          </div>
          <div className="feature">
            <span className="icon">🎯</span>
            <span>Multiple Providers</span>
          </div>
          <div className="feature">
            <span className="icon">🔒</span>
            <span>Type Safe</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default DemoApp;