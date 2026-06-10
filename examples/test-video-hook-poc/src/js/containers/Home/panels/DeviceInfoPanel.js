import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useDeviceInfo } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader } from '../components/SharedUI';

export function DeviceInfoPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.device;
  const setFallback = setFb('device');
  
  const { deviceInfo, webFallbackActive, refresh: refreshHook } = useDeviceInfo({ webFallback: fallback });
  const [, setRefreshTrigger] = useState(0);

  const info = deviceInfo?.data || deviceInfo;
  const src = webFallbackActive ? 'web' : 'native';

  const getOS = () => {
    if (info?.osVersion) return info.osVersion;
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent;
      const match = ua.match(/Android\s+([0-9.]+)/);
      if (match) return `Android ${match[1]}`;
      const iosMatch = ua.match(/OS\s+([0-9_]+)/);
      if (iosMatch) return `iOS ${iosMatch[1].replace(/_/g, '.')}`;
      const macMatch = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/);
      if (macMatch) return `macOS ${macMatch[1].replace(/_/g, '.')}`;
    }
    return '—';
  };

  const getLocale = () => {
    if (info?.locale) return info.locale;
    if (typeof navigator !== 'undefined') return navigator.language;
    return '—';
  };

  const getTimezone = () => {
    if (info?.timezone) return info.timezone;
    if (typeof Intl !== 'undefined') {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (e) {
        // Fallback to default
      }
    }
    return '—';
  };

  const getScreen = () => {
    if (info?.screenWidth && info?.screenHeight) return `${info.screenWidth}×${info.screenHeight}`;
    if (typeof window !== 'undefined') return `${window.innerWidth}×${window.innerHeight}`;
    return '—';
  };

  const getPixelRatio = () => {
    if (info?.pixelRatio) return `${parseFloat(info.pixelRatio).toFixed(2)}×`;
    if (typeof window !== 'undefined') return `${(window.devicePixelRatio || 1).toFixed(2)}×`;
    return '—';
  };

  const getUserAgent = () => {
    if (info?.userAgent) return info.userAgent;
    if (typeof navigator !== 'undefined') return navigator.userAgent;
    return '—';
  };

  const refresh = () => {
    if (refreshHook) {
      refreshHook();
    }
    setRefreshTrigger(prev => prev + 1);
  };

  const rows = [
    { key: 'Platform',  value: info?.platform || (webFallbackActive ? 'Web' : '—') },
    { key: 'Manufacturer', value: info?.manufacturer || (webFallbackActive ? 'Browser' : '—') },
    { key: 'OS',        value: getOS() },
    { key: 'Model',     value: info?.model || (webFallbackActive ? 'Web Client' : '—') },
    { key: 'Screen',    value: getScreen() },
    { key: 'Pixel ratio', value: getPixelRatio() },
    { key: 'Locale',    value: getLocale() },
    { key: 'Timezone',  value: getTimezone() },
    { key: 'App Version',value: info?.appVersion || info?.appInfo || (webFallbackActive ? 'Web App' : '—') },
    { key: 'User agent', value: getUserAgent() },
  ];

  return (
    <div className="col">
      <PanelHeader title="Device Info" hook="useDeviceInfo" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state="active" label="Fresh" source={webFallbackActive ? 'web' : 'native'} />

      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '11px 14px',
            borderTop: i === 0 ? 'none' : '0.5px solid var(--separator)',
          }}>
            <div style={{ flex: '0 0 96px', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 2 }}>
              {r.key}
            </div>
            <div className="grow" style={{ fontSize: 13, wordBreak: 'break-word', fontFamily: r.key === 'User agent' ? 'var(--mono)' : 'inherit', lineHeight: 1.4 }}>
              {r.value}
            </div>
            <span className={`source-badge source-badge--${src}`}>{src}</span>
          </div>
        ))}
      </div>

      <button className="btn btn--block" onClick={refresh}>
        {I.refresh()} Refresh
      </button>
    </div>
  );
}

export default DeviceInfoPanel;
