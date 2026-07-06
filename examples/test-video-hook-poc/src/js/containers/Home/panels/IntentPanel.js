import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useIntent } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader, DegradedBanner, useToast } from '../components/SharedUI';

export function IntentPanel() {
  const { execute, isNative } = useIntent();
  const { push } = useToast();
  const fileInputRef = useRef(null);

  const KINDS = [
    { id: 'file',   label: 'Open File' },
    { id: 'url',    label: 'Open URL'  },
    { id: 'share',  label: 'Share'     },
    { id: 'email',  label: 'Email'     },
  ];

  const [kind, setKind] = useState('file');

  // Per-kind state
  const [file, setFile] = useState(null);         // { url, name, type, size, file }
  const [url, setUrl] = useState('https://example.com');
  const [shareText, setShareText] = useState('Check out catalyst-core…');
  const [emailTo, setEmailTo] = useState('support@catalyst.dev');
  const [emailSub, setEmailSub] = useState('Bridge test');

  const [last, setLast] = useState(null);

  // Revoke URL when replaced/unmounted
  useEffect(() => {
    return () => {
      if (file?.url && file.url.startsWith('blob:')) {
        URL.revokeObjectURL(file.url);
      }
    };
  }, [file?.url]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (file?.url && file.url.startsWith('blob:')) {
      URL.revokeObjectURL(file.url);
    }
    setFile({
      url: URL.createObjectURL(f),
      name: f.name,
      type: f.type || 'application/octet-stream',
      size: f.size,
      file: f,
    });
    e.target.value = '';
  };

  // Classify a MIME type → intent "subtype" label + suggested app hint
  const classify = (mime) => {
    const m = (mime || '').toLowerCase();
    if (m === 'application/pdf')      return { kind: 'PDF',     hint: 'PDF viewer', icon: 'file' };
    if (m.startsWith('image/'))       return { kind: 'IMAGE',   hint: 'Gallery / Photos', icon: 'camera' };
    if (m.startsWith('video/'))       return { kind: 'VIDEO',   hint: 'Video player',  icon: 'video' };
    if (m.startsWith('audio/'))       return { kind: 'AUDIO',   hint: 'Music player',  icon: 'video' };
    if (m.startsWith('text/'))        return { kind: 'TEXT',    hint: 'Text editor',   icon: 'file' };
    if (m === 'application/zip')      return { kind: 'ARCHIVE', hint: 'Archive viewer', icon: 'file' };
    return { kind: 'GENERIC', hint: 'System chooser', icon: 'file' };
  };

  // Resolve intent payload for current kind
  const resolved = useMemo(() => {
    if (kind === 'file') {
      if (!file) return null;
      const c = classify(file.type);
      return {
        action: 'android.intent.action.VIEW',
        type:   file.type || '*/*',
        data:   `content://catalyst.fileprovider/${encodeURIComponent(file.name)}`,
        flags:  'FLAG_GRANT_READ_URI_PERMISSION',
        category: 'CATEGORY_DEFAULT',
        _subtype: c.kind,
        _hint: c.hint,
        _icon: c.icon,
      };
    }
    if (kind === 'url') {
      return { action: 'android.intent.action.VIEW', data: url, category: 'CATEGORY_BROWSABLE', _subtype: 'URL' };
    }
    if (kind === 'share') {
      return {
        action: 'android.intent.action.SEND',
        type:   'text/plain',
        EXTRA_TEXT: shareText,
        _subtype: 'SHARE',
      };
    }
    if (kind === 'email') {
      return {
        action: 'android.intent.action.SENDTO',
        data:   `mailto:${emailTo}`,
        EXTRA_SUBJECT: emailSub,
        _subtype: 'EMAIL',
      };
    }
    return null;
  }, [kind, file, url, shareText, emailSub, emailTo]);

  const fire = () => {
    if (!resolved) { push('Nothing to fire'); return; }
    setLast({ ...resolved, ts: new Date() });

    if (isNative) {
      console.log("🚀 [IntentPanel] firing native intent with payload:", resolved);
      execute(resolved);
      push(`Fired ${resolved._subtype} native intent`);
      return;
    }

    // Best-effort web "fallback" behavior — actually open something
    try {
      if (kind === 'file' && file) {
        window.open(file.url, '_blank', 'noopener');
        push(`Fired ${resolved._subtype} intent · opened in new tab`);
      } else if (kind === 'url' && url) {
        window.open(url, '_blank', 'noopener');
        push('Fired URL intent');
      } else if (kind === 'share') {
        if (navigator.share) {
          navigator.share({ text: shareText }).catch(() => {});
          push('navigator.share()');
        } else {
          push('Fired SHARE intent (no navigator.share)');
        }
      } else if (kind === 'email') {
        const sanitizedEmailTo = encodeURIComponent(emailTo).replace(/%40/g, '@');
        const href = `mailto:${sanitizedEmailTo}?subject=${encodeURIComponent(emailSub)}`;
        if (href.startsWith('mailto:')) {
          window.location.href = href;
        }
        push('Fired EMAIL intent');
      }
    } catch (e) {
      push(e?.message || 'Intent failed');
    }
  };

  // Render the resolved payload as a styled block
  const renderPayload = (p) => {
    if (!p) return null;
    const rows = Object.entries(p).filter(([k]) => !k.startsWith('_'));
    return (
      <div className="intent-payload">
        {rows.map(([k, v]) => (
          <div key={k}><span className="k">{k}:</span> <span className="v">{String(v)}</span></div>
        ))}
      </div>
    );
  };

  const formatBytes = (n) => {
    if (!n) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  };

  const extName = (name) => {
    const m = /\.([^.]+)$/.exec(name || '');
    return (m ? m[1] : 'file').slice(0, 4).toUpperCase();
  };

  return (
    <div className="col">
      <PanelHeader title="Intent" hook="useIntent" nativeOnly />
      <DegradedBanner reason="Android Intent system — web fallback opens the file/URL in a new tab instead of dispatching a system Intent." />
      <HookStatusBar state={isNative ? 'active' : 'error'} label={isNative ? 'Native active' : 'Web disabled'} source="native" />

      <div className="degraded col">
        <div className="card">
          <div className="card__label">Intent type</div>
          <div className="seg">
            {KINDS.map(k => (
              <div
                key={k.id}
                className={`seg__item ${kind === k.id ? 'seg__item--active' : ''}`}
                onClick={() => setKind(k.id)}
              >{k.label}</div>
            ))}
          </div>

          {/* Per-kind inputs */}
          {kind === 'file' && (
            <div className="col" style={{ marginTop: 12 }}>
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
              <button className="btn btn--block" onClick={() => fileInputRef.current?.click()}>
                {I.upload()} {file ? 'Replace file' : 'Pick a file'}
              </button>
              {file && (
                <div className="card card--inset" style={{ padding: '10px 12px', marginTop: 10 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="file-row__icon">{extName(file.name)}</div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{file.type} · {formatBytes(file.size)}</div>
                    </div>
                    <span className="pill pill--blue">{classify(file.type).kind}</span>
                  </div>
                  <div className="help" style={{ marginTop: 8 }}>
                    Suggested handler: <strong style={{ color: 'var(--text-primary)' }}>{classify(file.type).hint}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {kind === 'url' && (
            <div style={{ marginTop: 12 }}>
              <div className="card__label">URL</div>
              <input className="input input--mono" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}

          {kind === 'share' && (
            <div style={{ marginTop: 12 }}>
              <div className="card__label">Text to share</div>
              <textarea className="input" rows="2" value={shareText} onChange={e => setShareText(e.target.value)} />
            </div>
          )}

          {kind === 'email' && (
            <div className="col" style={{ marginTop: 12 }}>
              <div>
                <div className="card__label">To</div>
                <input className="input input--mono" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="user@example.com" />
              </div>
              <div>
                <div className="card__label">Subject</div>
                <input className="input" value={emailSub} onChange={e => setEmailSub(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Resolved payload */}
        <div className="card">
          <div className="spread" style={{ marginBottom: 8 }}>
            <div className="card__label" style={{ margin: 0 }}>Resolved intent</div>
            {resolved && <span className="pill pill--blue">{resolved._subtype}</span>}
          </div>
          {resolved
            ? renderPayload(resolved)
            : <div className="card__val" style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>Pick a file or enter input above</div>}
        </div>

        <button
          className="btn btn--primary btn--block btn--lg"
          onClick={fire}
          disabled={!resolved}
        >
          {I.intent()} Fire Intent
        </button>

        <div className="card">
          <div className="card__label">Last fired</div>
          {last ? (
            <React.Fragment>
              <div className="card__row">
                <span className="card__key">Subtype</span>
                <span className="pill pill--blue">{last._subtype}</span>
              </div>
              <div className="card__row">
                <span className="card__key">Action</span>
                <span className="card__val card__val--mono" style={{ maxWidth: '60%' }}>{last.action}</span>
              </div>
              {last.type && (
                <div className="card__row">
                  <span className="card__key">MIME</span>
                  <span className="card__val card__val--mono">{last.type}</span>
                </div>
              )}
              <div className="card__row">
                <span className="card__key">When</span>
                <span className="card__val card__val--mono">{last.ts.toLocaleTimeString()}</span>
              </div>
            </React.Fragment>
          ) : <div className="card__val" style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>No intent fired</div>}
        </div>
      </div>
    </div>
  );
}

export default IntentPanel;
