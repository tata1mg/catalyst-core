import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useNetworkStatus } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader } from '../components/SharedUI';

export function NetworkPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.network;
  const setFallback = setFb('network');
  const { online: isOnline, type, webFallbackActive } = useNetworkStatus({ webFallback: fallback });

  return (
    <div className="col">
      <PanelHeader title="Network Status" hook="useNetworkStatus" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state={isOnline ? 'active' : 'error'} label={isOnline ? 'Online' : 'Offline'} source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="state-display">
          <span className="state-display__icon" style={{ color: isOnline ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {isOnline ? I.wifi() : I.x()}
          </span>
          <span className={`state-display__big ${isOnline ? 'state--granted' : 'state--denied'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card__row">
          <span className="card__key">Connection</span>
          <span className="pill pill--blue">{(type || 'unknown').toString()}</span>
        </div>
      </div>
    </div>
  );
}

export default NetworkPanel;
