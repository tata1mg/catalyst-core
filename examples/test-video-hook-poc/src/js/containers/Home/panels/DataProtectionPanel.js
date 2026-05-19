import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useDataProtection } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader, useToast } from '../components/SharedUI';

export function DataProtectionPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.protect;
  const setFallback = setFb('protect');
  const { screenSecure, setScreenSecure, clearWebData, webFallbackActive, error } = useDataProtection({ webFallback: fallback });
  const { push } = useToast();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (error) push(error.message || "Security error");
  }, [error]);

  return (
    <div className="col">
      <PanelHeader title="Data Protection" hook="useDataProtection" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state={screenSecure ? 'active' : 'idle'} label={screenSecure ? 'Protection enabled' : 'Protection disabled'} source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="card__row">
          <span className="card__key">Protection</span>
          <span className={`pill ${screenSecure ? 'pill--green' : ''}`}>{screenSecure ? 'On' : 'Off'}</span>
        </div>
      </div>

      <div className="row">
        <button className="btn btn--primary grow" disabled={screenSecure} onClick={() => setScreenSecure(true)}>Enable</button>
        <button className="btn grow" disabled={!screenSecure} onClick={() => setScreenSecure(false)}>Disable</button>
      </div>

      <button className="btn btn--danger btn--block" onClick={() => setConfirming(true)}>
        {I.trash()} Clear Web Data
      </button>

      {confirming && (
        <div className="card" style={{ borderColor: 'var(--accent-red)' }}>
          <div className="card__label" style={{ color: 'var(--accent-red)' }}>Confirm clear</div>
          <div className="row">
            <button className="btn grow" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn--danger grow" onClick={() => { clearWebData(); setConfirming(false); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataProtectionPanel;
