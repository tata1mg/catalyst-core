import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { HookStatusBar, PanelHeader } from '../components/SharedUI';

export function SafeAreaPanel() {
  const { fallbacks, setFb, insets, webFallbackActive } = useOutletContext();
  const fallback = fallbacks.safe;
  const setFallback = setFb('safe');

  const dpr = !webFallbackActive && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  return (
    <div className="col">
      <PanelHeader title="Safe Area" hook="useSafeArea" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state="active" label="Live" source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="safearea-grid">
          {['top','right','bottom','left'].map(k => {
            const raw = insets?.[k] || 0;
            const scaled = Math.round(raw / dpr);
            return (
              <div className="safearea-cell" key={k}>
                <div className="safearea-cell__label">{k}</div>
                <div className="safearea-cell__val">{scaled}</div>
                {dpr > 1 && (
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {raw} px
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SafeAreaPanel;
