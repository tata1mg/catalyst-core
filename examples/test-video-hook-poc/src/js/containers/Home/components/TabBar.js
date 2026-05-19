import React, { useRef, useEffect } from 'react';
import { I } from './SharedUI';

export const TABS = [
  { id: 'video',      label: 'Video',     hook: 'useVideoStream',     icon: 'video',  native: false },
  { id: 'camera',     label: 'Camera',    hook: 'useCamera',          icon: 'camera', native: false },
  { id: 'files',      label: 'Files',     hook: 'useFilePicker',      icon: 'file',   native: false },
  { id: 'haptic',     label: 'Haptic',    hook: 'useHapticFeedback',  icon: 'haptic', native: false },
  { id: 'permission', label: 'Perm',      hook: 'useCameraPermission',icon: 'lock',   native: false },
  { id: 'network',    label: 'Network',   hook: 'useNetworkStatus',   icon: 'wifi',   native: false },
  { id: 'protect',    label: 'Protect',   hook: 'useDataProtection',  icon: 'shield', native: false },
  { id: 'safe',       label: 'SafeArea',  hook: 'useSafeArea',        icon: 'ruler',  native: false },
  { id: 'device',     label: 'Device',    hook: 'useDeviceInfo',      icon: 'info',   native: false },
  { id: 'notify',     label: 'Notify',    hook: 'useNotification',    icon: 'bell',   native: true  },
  { id: 'google',     label: 'Google',    hook: 'useGoogleSignIn',    icon: 'user',   native: true  },
  { id: 'intent',     label: 'Intent',    hook: 'useIntent',          icon: 'intent', native: true  },
];

export function TabBar({ active, onChange }) {
  const ref = useRef(null);

  // Auto-scroll active tab into view
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-tab="${active}"]`);
    if (el && el.scrollIntoView) {
      // Use scrollLeft to avoid affecting parent containers (scrollIntoView is forbidden by guidelines).
      const container = ref.current;
      const target = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
      container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
  }, [active]);

  return (
    <nav className="tabbar" aria-label="Bridge hooks">
      <div className="tabbar__scroll" ref={ref}>
        {TABS.map(t => {
          const isActive = active === t.id;
          return (
            <div
              key={t.id}
              data-tab={t.id}
              className={`tabbar__item ${isActive ? 'tabbar__item--active' : ''}`}
              onClick={() => onChange(t.id)}
              role="button"
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="tabbar__icon">
                {I[t.icon] ? I[t.icon]() : null}
                {t.native && <span className="tabbar__native-chip" title="native-only" />}
              </span>
              <span className="tabbar__label">{t.label}</span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function AppHeader({ theme, onToggleTheme, platform, anyActive, onOpenSettings }) {
  return (
    <header className="app-header">
      <div className="app-header__left">
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? I.sun() : I.moon()}
        </button>
        {onOpenSettings && (
          <button
            className="icon-btn"
            onClick={onOpenSettings}
            aria-label="Transition settings"
            title="Transition settings"
            style={{ marginLeft: 6 }}
          >
            {I.gear()}
          </button>
        )}
      </div>
      <div className="app-header__title">Bridge Test</div>
      <div className="app-header__right">
        <span className={`dot ${anyActive ? 'dot--active' : ''}`} title={anyActive ? 'Hook active' : 'Idle'} />
        <span className={`pill ${platform === 'NATIVE' ? 'pill--green' : 'pill--blue'}`}>{platform}</span>
      </div>
    </header>
  );
}
