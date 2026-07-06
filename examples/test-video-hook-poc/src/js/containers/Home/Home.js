import { useLocation, Outlet } from 'react-router-dom';
import { useNativeTransition } from 'catalyst-core/hooks';
import React, { useState, useEffect } from 'react';
import { useSafeArea } from 'catalyst-core/hooks';
import { useTheme } from './components/Theme';
import { ToastProvider, BottomSheet } from './components/SharedUI';
import { TabBar, AppHeader, TABS } from './components/TabBar';
import IOSDevice from './components/IOSDevice';

// Import global styles
import '../../../static/css/Bridge.css';

class LocalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("Panel crashed:", error, info);
  }
  componentDidUpdate(prevProps) {
    if (prevProps.activeTab !== this.props.activeTab && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'var(--accent-red)' }}>
          <h3 style={{ marginBottom: 8 }}>Panel Crashed</h3>
          <p style={{ marginBottom: 16, opacity: 0.8 }}>{this.state.error?.message || "An unexpected error occurred in this hook."}</p>
          <button className="btn" onClick={() => this.setState({ hasError: false, error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Home() {
  const [theme, toggleTheme] = useTheme();
  
  useEffect(() => {
    const isBridgeAvailable = typeof window !== 'undefined' && !!window.WebBridge;
    console.log(`🏠 [Home] Catalyst Bridge detected:`, isBridgeAvailable);
    if (isBridgeAvailable) {
      console.log(`🏠 [Home] Native handlers:`, {
        NativeBridge: !!window.NativeBridge,
        webkit: !!window.webkit?.messageHandlers?.NativeBridge
      });
    }
  }, []);

  const location = useLocation();
  const [transitionOpts, setTransitionOpts] = useState({
    type: 'slide',
    direction: 'auto', // 'auto', 'left', 'right', 'up', 'down'
    duration: 280,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { navigate } = useNativeTransition({ type: 'slide', duration: 280 });
  const pathPart = location.pathname.split('/')[1];
  const active = pathPart || 'video';

  const [fallbacks, setFallbacks] = useState({
    video: false, camera: false, files: false, haptic: false,
    permission: false, network: false, protect: false, safe: false, device: false,
  });

  const setFb = (key) => (v) => {
    console.log("🏠 [Home] Setting fallback for", key, "to:", v);
    setFallbacks(s => ({ ...s, [key]: v }));
  };

  const { top, right, bottom, left, isNative, webFallbackActive } = useSafeArea({ webFallback: fallbacks.safe });
  const platform = isNative ? 'NATIVE' : 'WEB';

  // Sync default UI fallback toggles with environment once detected by the hook
  useEffect(() => {
    setFallbacks({
      video: !isNative, camera: !isNative, files: !isNative, haptic: !isNative,
      permission: !isNative, network: !isNative, protect: !isNative, safe: !isNative, device: !isNative,
    });
  }, [isNative]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (!isNative) {
        // Force simulated iOS 26 safe areas when wrapped in the desktop IOSDevice frame
        document.documentElement.style.setProperty('--sat', '47px');
        document.documentElement.style.setProperty('--sar', '0px');
        document.documentElement.style.setProperty('--sab', '34px');
        document.documentElement.style.setProperty('--sal', '0px');
      } else {
        const dpr = !webFallbackActive ? window.devicePixelRatio || 1 : 1;
        document.documentElement.style.setProperty('--sat', `${(top || 0) / dpr}px`);
        document.documentElement.style.setProperty('--sar', `${(right || 0) / dpr}px`);
        document.documentElement.style.setProperty('--sab', `${(bottom || 0) / dpr}px`);
        document.documentElement.style.setProperty('--sal', `${(left || 0) / dpr}px`);
      }
    }
  }, [top, right, bottom, left, isNative, webFallbackActive]);

  const setActive = (id) => {
    console.log(`🏠 [Home] setActive (navigate):`, id);
    const fromIndex = TABS.findIndex(t => t.id === active);
    const toIndex   = TABS.findIndex(t => t.id === id);
    
    let resolvedDirection;
    if (transitionOpts.direction === 'auto') {
      resolvedDirection = toIndex >= fromIndex ? 'right' : 'left';
    } else {
      resolvedDirection = transitionOpts.direction;
    }

    console.log(`🏠 [Home] Navigating tab with transition options:`, {
      type: transitionOpts.type,
      direction: resolvedDirection,
      duration: transitionOpts.duration
    });

    navigate(`/${id}`, {
      replace: true,
      direction: resolvedDirection,
      type: transitionOpts.type,
      duration: transitionOpts.duration
    });
  };

  useEffect(() => {
    console.log(`🏠 [Home] Route active tab changed to:`, active);
  }, [active]);

  const tab = TABS.find(t => t.id === active) || TABS[0];
  const anyActive = !tab.native && fallbacks[tab.id];

  const appContent = (
    <div className="app-shell" data-theme={theme}>
      <ToastProvider>
        <AppHeader
          theme={theme}
          onToggleTheme={toggleTheme}
          platform={platform}
          anyActive={anyActive}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="content">
          <LocalErrorBoundary activeTab={active}>
            <div key={location.pathname} className="panel-wrap" style={{ viewTransitionName: 'panel' }}>
              <Outlet context={{ fallbacks, setFb, insets: { top, right, bottom, left }, webFallbackActive, isWeb: !isNative }} />
            </div>
          </LocalErrorBoundary>
        </main>

        <TabBar active={active} onChange={setActive} />

        <BottomSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Native Transition Settings"
        >
          <div className="col" style={{ gap: 16, marginTop: 8 }}>
            <div className="card">
              <div className="card__label">Transition Type</div>
              <div className="seg">
                <button
                  type="button"
                  className={`seg__item ${transitionOpts.type === 'slide' ? 'seg__item--active' : ''}`}
                  onClick={() => setTransitionOpts(prev => ({ ...prev, type: 'slide' }))}
                  style={{ border: 'none', background: 'transparent' }}
                >
                  Slide
                </button>
                <button
                  type="button"
                  className={`seg__item ${transitionOpts.type === 'fade' ? 'seg__item--active' : ''}`}
                  onClick={() => setTransitionOpts(prev => ({ ...prev, type: 'fade' }))}
                  style={{ border: 'none', background: 'transparent' }}
                >
                  Fade
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card__label">Transition Direction</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {['auto', 'left', 'right', 'up', 'down'].map(dir => (
                  <button
                    key={dir}
                    type="button"
                    className={`btn ${transitionOpts.direction === dir ? 'btn--primary' : ''}`}
                    style={{ fontSize: 13, height: 32, padding: '0 6px', textTransform: 'capitalize' }}
                    onClick={() => setTransitionOpts(prev => ({ ...prev, direction: dir }))}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="spread" style={{ marginBottom: 8 }}>
                <span className="card__label" style={{ margin: 0 }}>Duration</span>
                <span className="kbd" style={{ fontSize: 13, fontWeight: 'bold' }}>{transitionOpts.duration} ms</span>
              </div>
              <input
                type="range"
                className="slider"
                min="50"
                max="1500"
                step="50"
                value={transitionOpts.duration}
                onChange={e => {
                  const val = parseInt(e.target.value, 10);
                  setTransitionOpts(prev => ({ ...prev, duration: val }));
                }}
              />
              <div className="spread" style={{ marginTop: 6, fontSize: 10, color: 'var(--text-secondary)' }}>
                <span>Snappy (50ms)</span>
                <span>Cinematic (1500ms)</span>
              </div>
            </div>

            <div className="card card--inset">
              <div className="card__label">Hook Signature Preview</div>
              <pre className="card__val--mono" style={{ fontSize: 11, margin: 0, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 6, textAlign: 'left', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
{`navigate(url, {
  replace: true,
  type: '${transitionOpts.type}',
  direction: '${transitionOpts.direction === 'auto' ? 'left | right' : transitionOpts.direction}',
  duration: ${transitionOpts.duration}
});`}
              </pre>
            </div>
            
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ height: 44 }}
              onClick={() => setSettingsOpen(false)}
            >
              Apply and Close
            </button>
          </div>
        </BottomSheet>

        {/* Portal target for bottom sheet overlays */}
        <div className="overlay-root" />
      </ToastProvider>
    </div>
  );

  if (!isNative) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: 24,
        background: theme === 'dark' ? '#15161a' : '#e9ebf0',
        transition: 'background 0.2s ease'
      }}>
        <IOSDevice dark={theme === 'dark'} width={402} height={874}>
          {appContent}
        </IOSDevice>
      </div>
    );
  }

  return appContent;
}

export default Home;
