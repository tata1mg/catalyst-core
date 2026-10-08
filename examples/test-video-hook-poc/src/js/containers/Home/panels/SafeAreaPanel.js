import React from 'react';
import { useOutletContext } from 'react-router';
import { HookStatusBar, PanelHeader } from '../components/SharedUI';

export function SafeAreaPanel() {
  const { fallbacks, setFb, insets, webFallbackActive } = useOutletContext();
  const fallback = fallbacks.safe;
  const setFallback = setFb('safe');

  return (
    <div className="col">
      <PanelHeader title="Safe Area" hook="useSafeArea" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state="active" label="Live" source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="safearea-grid">
          {['top','right','bottom','left'].map(k => {
            const value = Math.round(insets?.[k] || 0);
            return (
              <div className="safearea-cell" key={k}>
                <div className="safearea-cell__label">{k}</div>
                <div className="safearea-cell__val">{value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SafeAreaPanel;
