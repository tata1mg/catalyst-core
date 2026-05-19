import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useHapticFeedback } from 'catalyst-core/hooks';
import { HookStatusBar, PanelHeader, useToast } from '../components/SharedUI';

export function HapticPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.haptic;
  const setFallback = setFb('haptic');
  const { light, medium, heavy, success, warning, errorHaptic, selection, isSupported, webFallbackActive } = useHapticFeedback({ webFallback: fallback });
  const { push } = useToast();
  const [fired, setFired] = useState(null);

  const fire = (kind, fn) => {
    console.log(`📳 [HapticPanel] Firing ${kind}`);
    if (fn) fn();
    setFired(kind);
    setTimeout(() => setFired(f => f === kind ? null : f), 460);
  };

  const cell = (kind, label, sub, fn) => (
    <div className={`haptic-cell ${fired === kind ? 'haptic-cell--fired' : ''}`} onClick={() => fire(kind, fn)}>
      <span>{label}</span>
      <span className="haptic-cell__sub">{sub}</span>
    </div>
  );

  return (
    <div className="col">
      <PanelHeader title="Haptic Feedback" hook="useHapticFeedback" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state={fired ? 'active' : 'idle'} label={fired ? `Fired: ${fired}` : 'Idle'} source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="card__label">Impact</div>
        <div className="grid-3">
          {cell('light',  'Light',  'impact',  light)}
          {cell('medium', 'Medium', 'impact',  medium)}
          {cell('heavy',  'Heavy',  'impact',  heavy)}
        </div>
      </div>

      <div className="card">
        <div className="card__label">Notification</div>
        <div className="grid-3">
          {cell('success', 'Success', 'notify', success)}
          {cell('warning', 'Warning', 'notify', warning)}
          {cell('error',   'Error',   'notify', errorHaptic)}
        </div>
      </div>

      <div className="card">
        <div className="card__label">Selection</div>
        {cell('selection', 'Selection', 'tap to fire', selection)}
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <span className={`pill ${isSupported ? 'pill--green' : 'pill--red'}`}>
          {isSupported ? 'vibrate supported' : 'not supported'}
        </span>
      </div>
    </div>
  );
}

export default HapticPanel;
