import React, { useState, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom';
import { useOutletContext } from 'react-router-dom';

// ───────────── Icons ─────────────
export const I = {
  sun:     (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 18, ...p.style }} {...p}>light_mode</span>,
  moon:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 18, ...p.style }} {...p}>dark_mode</span>,
  warn:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 18, ...p.style }} {...p}>warning</span>,
  video:   (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>videocam</span>,
  camera:  (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>photo_camera</span>,
  file:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>description</span>,
  haptic:  (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>vibration</span>,
  lock:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>lock</span>,
  wifi:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>wifi</span>,
  shield:  (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>shield</span>,
  ruler:   (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>straighten</span>,
  info:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>info</span>,
  bell:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>notifications</span>,
  user:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>person</span>,
  intent:  (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>send</span>,
  refresh: (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>refresh</span>,
  zap:     (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>bolt</span>,
  flip:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>sync</span>,
  x:       (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>close</span>,
  qr:      (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>qr_code_scanner</span>,
  upload:  (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>upload</span>,
  trash:   (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>delete</span>,
  check:   (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>check</span>,
  gear:    (p={}) => <span className="material-symbols-outlined" style={{ fontSize: 20, ...p.style }} {...p}>settings</span>,
  google:  () => (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ verticalAlign: 'middle', display: 'inline-block' }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.95v2.32A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.73a5.42 5.42 0 0 1 0-3.46V4.95H.95a9 9 0 0 0 0 8.1l3.02-2.32z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .95 4.95l3.02 2.32C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  ),
};


// ───────────── HookStatusBar ─────────────
export function HookStatusBar({ state = 'idle', label, source = 'web' }) {
  const map = {
    idle:    { color: 'var(--text-secondary)', text: label || 'Idle' },
    loading: { color: 'var(--accent-blue)',    text: label || 'Working…' },
    active:  { color: 'var(--accent-green)',   text: label || 'Active' },
    error:   { color: 'var(--accent-red)',     text: label || 'Error' },
  };
  const s = map[state] || map.idle;
  return (
    <div className="hookbar" role="status">
      <div className="hookbar__state" style={{ color: s.color }}>
        {state === 'loading' ? <span className="spinner" /> : <span className="dot" style={{ background: s.color, boxShadow: state === 'active' ? `0 0 0 4px color-mix(in oklab, ${s.color} 22%, transparent)` : 'none' }} />}
        {s.text}
      </div>
      <span className={`source-badge source-badge--${source}`}>{source === 'native' ? 'Native bridge' : 'Web fallback'}</span>
    </div>
  );
}

// ───────────── ErrorToast (context-driven) ─────────────
const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };
  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>
            <span style={{ width: 14, height: 14, display: 'inline-flex' }}>{I.warn({ width: 14, height: 14 })}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() { return useContext(ToastCtx); }

// ───────────── FallbackToggle ─────────────
export function FallbackToggle({ on, onChange }) {
  return (
    <button
      type="button"
      className={`fallback-toggle ${on ? 'fallback-toggle--on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <span className="fallback-toggle__sw" />
      Fallback {on ? 'ON' : 'OFF'}
    </button>
  );
}

// ───────────── DegradedBanner ─────────────
export function DegradedBanner({ reason }) {
  return (
    <div className="degraded-banner">
      {I.warn()}
      <div>
        <strong>No web fallback</strong>
        Connect a native device to test. {reason}
      </div>
    </div>
  );
}

// ───────────── PanelHeader ─────────────
export function PanelHeader({ title, hook, fallback, onFallbackChange, nativeOnly, trailing }) {
  let isWeb = true;
  try {
    const context = useOutletContext();
    if (context && typeof context.isWeb !== 'undefined') {
      isWeb = context.isWeb;
    }
  } catch (e) {
    // Ignore error if rendered outside of Router context
  }

  return (
    <div className="spread" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="panel-title">{title}</div>
        <div className="panel-sub">{hook}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {trailing}
        {nativeOnly
          ? <span className="pill pill--amber">native-only</span>
          : (isWeb && <FallbackToggle on={fallback} onChange={onFallbackChange} />)}
      </div>
    </div>
  );
}

// ───────────── BottomSheet (portal to .overlay-root within app-shell) ─────────────
export function BottomSheet({ open, onClose, title, children, vtName }) {
  const [mount, setMount] = useState(null);
  useEffect(() => {
    setMount(document.querySelector('.overlay-root'));
  }, []);

  const [renderSheet, setRenderSheet] = useState(open);
  useEffect(() => {
    if (open) { setRenderSheet(true); return; }
    const t = setTimeout(() => setRenderSheet(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  if (!mount || !renderSheet) return null;
  const sheet = (
    <React.Fragment>
      <div
        className={`sheet-backdrop ${open ? 'sheet-backdrop--open' : ''}`}
        onClick={onClose}
      />
      <div
        className={`sheet ${open ? 'sheet--open' : ''}`}
        style={vtName ? { viewTransitionName: vtName } : undefined}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet__grip" />
        <div className="sheet__head">
          <div className="sheet__title">{title}</div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">{I.x()}</button>
        </div>
        {children}
      </div>
    </React.Fragment>
  );
  return ReactDOM.createPortal(sheet, mount);
}

// ───────────── Switch helper ─────────────
export function Switch({ on, onChange, label }) {
  return (
    <div
      className={`switch ${on ? 'switch--on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

// ───────────── Section helper ─────────────
export function Section({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section ${open ? 'section--open' : ''}`}>
      <div className="section__head" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className="chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </span>
      </div>
      {open && <div className="section__body">{children}</div>}
    </div>
  );
}

// ───────────── Lightbox (full-bleed overlay, portals to .overlay-root) ─────────────
export function Lightbox({ open, onClose, title, subtitle, children, footer }) {
  const [mount, setMount] = useState(null);
  useEffect(() => { setMount(document.querySelector('.overlay-root')); }, []);

  // Keep mounted briefly through close transition
  const [render, setRender] = useState(open);
  useEffect(() => {
    if (open) { setRender(true); return; }
    const t = setTimeout(() => setRender(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mount || !render) return null;
  return ReactDOM.createPortal(
    <React.Fragment>
      <div
        className={`lightbox-backdrop ${open ? 'lightbox-backdrop--open' : ''}`}
        onClick={onClose}
      />
      <div
        className={`lightbox ${open ? 'lightbox--open' : ''}`}
        role="dialog" aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      >
        <div className="lightbox__head">
          <div className="grow">
            <div className="lightbox__title">{title}</div>
            {subtitle && <div className="lightbox__sub">{subtitle}</div>}
          </div>
          <button className="lightbox__close" onClick={onClose} aria-label="Close">{I.x()}</button>
        </div>
        <div className="lightbox__body">{children}</div>
        {footer && <div className="lightbox__foot">{footer}</div>}
      </div>
    </React.Fragment>,
    mount
  );
}

// ───────────── FileViewer (type-aware preview body) ─────────────
export function FileViewer({ file }) {
  // file: { url, name, type, size, file? (raw File) }
  const [text, setText] = useState(null);
  const [err, setErr]   = useState(null);
  const mime = (file?.type || '').toLowerCase();
  const isText = /^(text\/|application\/(json|xml|javascript|x-sh|x-)|application\/yaml)/.test(mime)
              || /\.(txt|md|json|xml|csv|js|ts|jsx|tsx|css|html|log|yml|yaml|sh)$/i.test(file?.name || '');

  useEffect(() => {
    if (!isText || !file?.file) return;
    let cancelled = false;
    file.file.text().then(t => { if (!cancelled) setText(t.length > 100_000 ? t.slice(0, 100_000) + '\n…[truncated]' : t); })
      .catch(e => { if (!cancelled) setErr(e?.message || 'read error'); });
    return () => { cancelled = true; };
  }, [file, isText]);

  if (mime.startsWith('image/'))    return <img src={file.url} alt={file.name} />;
  if (mime.startsWith('video/'))    return <video src={file.url} controls autoPlay />;
  if (mime.startsWith('audio/'))    return <audio src={file.url} controls autoPlay style={{ width: '90%' }} />;
  if (mime === 'application/pdf')   return <iframe src={file.url} title={file.name} />;
  if (isText) {
    return (
      <pre className="lightbox__text">
        {err ? `Failed to read: ${err}` : text == null ? 'Reading…' : text}
      </pre>
    );
  }
  // Unknown — show metadata + open-in-new-tab
  return (
    <div className="lightbox__unknown">
      <div className="bigicon">{I.file()}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{file.name}</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{mime || 'unknown'} · {formatBytes(file.size)}</div>
      </div>
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="btn btn--primary" style={{ textDecoration: 'none' }}>
        {I.upload()} Open in new tab
      </a>
    </div>
  );
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
