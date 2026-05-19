import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useVideoStream } from 'catalyst-core/hooks';
import { I, HookStatusBar, useToast, PanelHeader, BottomSheet, Switch } from '../components/SharedUI';

export function VideoStreamPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.video;
  const setFallback = setFb('video');
  const { push } = useToast();
  
  const [zoom, setZoom] = useState(1);
  const [qr, setQr] = useState(null);
  const [qrFlash, setQrFlash] = useState(false);

  // Start options (hook configurations)
  const [facing, setFacing] = useState('back');         // 'back' | 'front'
  const [format, setFormat] = useState('all');          // 'qr' | 'barcode' | 'all'
  const [autoZoom, setAutoZoom] = useState(false);      // zoom.auto
  const [initialZoom, setInitialZoom] = useState(1.0);  // zoom.initial
  const [fpsMin, setFpsMin] = useState('');             // start option
  const [fpsMax, setFpsMax] = useState('');             // start option

  // streamState / live editing states
  const [editingFps, setEditingFps] = useState(false);
  const [editMin, setEditMin] = useState('');
  const [editMax, setEditMax] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [restartNote, setRestartNote] = useState(false);

  const onQRDetected = useCallback((data) => {
    console.log("📹 [VideoStreamPanel] QR Detected:", data);
    setQr(JSON.stringify(data));
    setQrFlash(true);
    setTimeout(() => setQrFlash(false), 400);
  }, []);

  const { isStreaming, streamState, error, start, stop, sendCommand, flip, webFallbackActive, mediaStream } = useVideoStream({ onQRDetected, webFallback: fallback });
  const videoRef = useRef(null);

  useEffect(() => {
    if (error) push(error.message || "Video stream error");
  }, [error]);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  useEffect(() => {
    if (isStreaming && !webFallbackActive) {
      document.body.classList.add('video-streaming');
    } else {
      document.body.classList.remove('video-streaming');
    }
    return () => document.body.classList.remove('video-streaming');
  }, [isStreaming, webFallbackActive]);

  // Synchronize zoom state with streamState updates if any
  useEffect(() => {
    if (streamState?.zoom !== undefined && streamState?.zoom !== null) {
      setZoom(streamState.zoom);
    }
  }, [streamState?.zoom]);

  const handleStart = (opts = {}) => {
    console.log("📹 [VideoStreamPanel] handleStart called", { webFallbackActive, fallback });
    
    // Safety check for browser environment
    if (!webFallbackActive && typeof window !== 'undefined' && !window.NativeBridge && !window.webkit?.messageHandlers?.NativeBridge) {
      push("Native bridge not available. Enable 'Web Fallback' to test in a browser.");
      return;
    }

    const startOpts = {
      facing: opts.facing ?? facing,
      format: opts.format ?? format,
      zoom: {
        auto: opts.autoZoom ?? autoZoom,
        initial: opts.initialZoom ?? initialZoom
      }
    };

    const minVal = opts.fpsMin ?? fpsMin;
    const maxVal = opts.fpsMax ?? fpsMax;
    if (minVal || maxVal) {
      startOpts.fps = {};
      if (minVal) startOpts.fps.min = Number(minVal);
      if (maxVal) startOpts.fps.max = Number(maxVal);
    }

    console.log("📹 [VideoStreamPanel] Invoking start() with options:", startOpts);
    start(startOpts);
  };

  const handleStop = () => {
    console.log("📹 [VideoStreamPanel] handleStop called");
    stop();
    setRestartNote(false);
  };

  const handleZoom = (e) => {
    const v = parseFloat(e.target.value);
    console.log("📹 [VideoStreamPanel] handleZoom change:", v);
    setZoom(v);
    sendCommand('zoom', v);
  };

  const handleTorch = () => {
    const nextState = !streamState?.torchOn;
    console.log("📹 [VideoStreamPanel] handleTorch toggling to:", nextState);
    sendCommand('torch', nextState);
  };

  const handleFlip = () => {
    console.log("📹 [VideoStreamPanel] handleFlip camera");
    flip();
    setFacing(f => f === 'back' ? 'front' : 'back');
  };

  // sendCommand('fps', { min, max }) — live
  const applyLiveFps = () => {
    const min = editMin ? Number(editMin) : null;
    const max = editMax ? Number(editMax) : null;
    if (min !== null && max !== null && min > max) {
      push('Min FPS must be ≤ Max FPS');
      return;
    }
    setEditingFps(false);
    console.log(`📹 [VideoStreamPanel] sendCommand('fps') live update:`, { min, max });
    sendCommand('fps', { min, max });
  };

  // Apply configurations from the BottomSheet
  const applySettings = (opts) => {
    setFacing(opts.facing);
    setFormat(opts.format);
    setAutoZoom(opts.autoZoom);
    setInitialZoom(opts.initialZoom);
    setFpsMin(opts.fpsMin);
    setFpsMax(opts.fpsMax);
    closeSheet();

    if (isStreaming) {
      // Live updates: fps uses sendCommand, facing/format need restart
      const min = opts.fpsMin ? Number(opts.fpsMin) : null;
      const max = opts.fpsMax ? Number(opts.fpsMax) : null;
      sendCommand('fps', { min, max });
      setRestartNote(true);
    } else {
      handleStart({
        facing: opts.facing,
        format: opts.format,
        autoZoom: opts.autoZoom,
        initialZoom: opts.initialZoom,
        fpsMin: opts.fpsMin,
        fpsMax: opts.fpsMax
      });
    }
  };

  const openSheet = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const gearButton = (
    <button
      className="btn btn--ghost"
      style={{ width: 36, height: 36, padding: 0, minWidth: 0, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={openSheet}
      aria-label="Stream settings"
      title="Stream settings"
    >
      {I.gear({ style: { fontSize: 20 } })}
    </button>
  );

  return (
    <div className="col">
      <PanelHeader
        title="Video Stream"
        hook="useVideoStream"
        fallback={fallback}
        onFallbackChange={setFallback}
        trailing={gearButton}
      />
      <HookStatusBar state={isStreaming ? 'active' : 'idle'} label={isStreaming ? 'Streaming' : 'Idle'} source={webFallbackActive ? 'web' : 'native'} />

      <div className={`camera-stage ${qrFlash ? 'qr-flash' : ''}`}>
        {isStreaming
          ? (webFallbackActive ? <video ref={videoRef} autoPlay muted playsInline style={{ transform: `scale(${zoom})` }} /> : null)
          : (
            <div className="camera-stage__placeholder">
              <span style={{ opacity: 0.6 }}>{I.qr()}</span>
              <span>Camera offline</span>
            </div>
          )}
        <div className={`viewfinder ${qrFlash ? 'viewfinder--flash' : ''}`}>
          <div className="viewfinder__corner tl" />
          <div className="viewfinder__corner tr" />
          <div className="viewfinder__corner bl" />
          <div className="viewfinder__corner br" />
        </div>
      </div>

      {/* Active settings indicators strip */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: -4 }}>
        <span className="pill">{facing === 'front' ? 'Front Camera' : 'Back Camera'}</span>
        <span className="pill pill--blue">{format.toUpperCase()}</span>
        <span className={`pill ${autoZoom ? 'pill--green' : ''}`}>
          Auto-zoom: {autoZoom ? 'ON' : 'OFF'}
        </span>
        {(fpsMin || fpsMax) && (
          <span className="pill">FPS {fpsMin || '—'}–{fpsMax || '—'}</span>
        )}
      </div>

      {format !== 'barcode' && (
        <div className="card">
          <div className="card__label">Last QR scan</div>
          <div className="card__val card__val--mono" style={{ textAlign: 'left', color: qr ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
            {qr || 'No scan yet'}
          </div>
        </div>
      )}

      {isStreaming && (
        <div className="card col" style={{ gap: 12 }}>
          {restartNote && (
            <div className="help" style={{ color: 'var(--accent-amber)', marginTop: 0, fontWeight: 500 }}>
              Restart stream to apply camera/format changes.
            </div>
          )}
          <div>
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="card__key">Zoom</span>
              <span className="card__val card__val--mono">{(zoom || 1).toFixed(1)}×</span>
            </div>
            <input
              className="slider"
              type="range" min="1" max="5" step="0.1"
              value={zoom || 1} onChange={handleZoom}
            />
          </div>

          {/* FPS live edit */}
          <div>
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="card__key">FPS range</span>
              {!editingFps && (
                <button
                  className="btn btn--ghost"
                  style={{ height: 22, padding: '0 8px', color: 'var(--accent-blue)', fontSize: 12 }}
                  onClick={() => {
                    setEditMin(streamState?.fps?.min?.toString() || fpsMin || '');
                    setEditMax(streamState?.fps?.max?.toString() || fpsMax || '');
                    setEditingFps(true);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
            {editingFps ? (
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  className="input input--num"
                  type="number" min="1" placeholder="min"
                  value={editMin} onChange={e => setEditMin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyLiveFps()}
                />
                <span className="card__key">–</span>
                <input
                  className="input input--num"
                  type="number" min="1" placeholder="max"
                  value={editMax} onChange={e => setEditMax(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyLiveFps()}
                />
                <button className="btn btn--primary" style={{ height: 32, padding: '0 10px', fontSize: 13 }} onClick={applyLiveFps}>Apply</button>
              </div>
            ) : (
              <span className="pill pill--blue">
                {streamState?.fps?.min || fpsMin || '—'} – {streamState?.fps?.max || fpsMax || '—'} fps
              </span>
            )}
          </div>

          <div className="row">
            <button
              className="btn grow"
              onClick={handleTorch}
              style={streamState?.torchOn ? { background: 'var(--accent-yellow)', color: '#1a1a1a', borderColor: 'transparent' } : null}
            >
              {I.zap()} {streamState?.torchOn ? 'Torch on' : 'Torch'}
            </button>
            <button className="btn grow" onClick={handleFlip}>{I.flip()} Flip</button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', padding: '4px 0 0' }}>
        {isStreaming
          ? <button className="round-btn round-btn--stop" onClick={handleStop} aria-label="Stop"><span style={{ width: 18, height: 18, background: '#fff', borderRadius: 3, display: 'block' }} /></button>
          : <button className="round-btn" onClick={() => handleStart()} aria-label="Start"><span style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid #fff', boxSizing: 'border-box', display: 'block' }} /></button>}
      </div>

      <VideoStreamSettingsSheet
        open={sheetOpen}
        onClose={closeSheet}
        streaming={isStreaming}
        initial={{ facing, format, autoZoom, initialZoom, fpsMin, fpsMax }}
        onApply={applySettings}
      />
    </div>
  );
}

function VideoStreamSettingsSheet({ open, onClose, streaming, initial, onApply }) {
  const [facing, setFacing] = useState(initial.facing);
  const [format, setFormat] = useState(initial.format);
  const [autoZoom, setAutoZoom] = useState(initial.autoZoom);
  const [initialZoom, setInitialZoom] = useState(initial.initialZoom);
  const [fpsMin, setFpsMin] = useState(initial.fpsMin);
  const [fpsMax, setFpsMax] = useState(initial.fpsMax);

  // Sync state whenever settings are opened
  useEffect(() => {
    if (open) {
      setFacing(initial.facing);
      setFormat(initial.format);
      setAutoZoom(initial.autoZoom);
      setInitialZoom(initial.initialZoom);
      setFpsMin(initial.fpsMin);
      setFpsMax(initial.fpsMax);
    }
  }, [open, initial]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Stream Settings" vtName="stream-settings">
      <div className="col" style={{ gap: 12 }}>
        <div>
          <div className="card__label">Camera</div>
          <div className="btn-toggle">
            <button className={`btn-toggle__item ${facing === 'back' ? 'btn-toggle__item--active' : ''}`} onClick={() => setFacing('back')}>Back</button>
            <button className={`btn-toggle__item ${facing === 'front' ? 'btn-toggle__item--active' : ''}`} onClick={() => setFacing('front')}>Front</button>
          </div>
        </div>

        <div>
          <div className="card__label">Scan format</div>
          <div className="seg">
            {['qr', 'barcode', 'all'].map(f => (
              <button key={f} className={`seg__item ${format === f ? 'seg__item--active' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="card card--inset" style={{ padding: '4px 12px' }}>
          <div className="field">
            <div>
              <div className="field__label">Auto-zoom (ML Kit)</div>
              <div className="field__hint">zoom.auto · adjusts zoom to scanned target</div>
            </div>
            <Switch on={autoZoom} onChange={setAutoZoom} label="Auto-zoom" />
          </div>
          <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="spread">
              <div className="field__label">Initial zoom</div>
              <span className="card__val card__val--mono">{initialZoom.toFixed(1)}×</span>
            </div>
            <input
              className="slider"
              type="range" min="1" max="5" step="0.1"
              value={initialZoom}
              onChange={e => setInitialZoom(parseFloat(e.target.value))}
            />
          </div>
        </div>

        <div className="card card--inset" style={{ padding: '10px 12px' }}>
          <div className="card__label" style={{ marginBottom: 8 }}>FPS range</div>
          <div className="row" style={{ gap: 8 }}>
            <div className="col" style={{ flex: 1, gap: 4 }}>
              <span className="field__hint">Min</span>
              <input className="input input--num" style={{ width: '100%' }} type="number" min="1" placeholder="—" value={fpsMin} onChange={e => setFpsMin(e.target.value)} />
            </div>
            <div className="col" style={{ flex: 1, gap: 4 }}>
              <span className="field__hint">Max</span>
              <input className="input input--num" style={{ width: '100%' }} type="number" min="1" placeholder="—" value={fpsMax} onChange={e => setFpsMax(e.target.value)} />
            </div>
          </div>
          <div className="help">Leave empty to let the device choose. Live edits use sendCommand('fps').</div>
        </div>

        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary grow"
            onClick={() => {
              if (fpsMin && fpsMax && Number(fpsMin) > Number(fpsMax)) return;
              onApply({ facing, format, autoZoom, initialZoom, fpsMin, fpsMax });
            }}
          >
            {streaming ? 'Apply' : 'Apply & Start'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

export default VideoStreamPanel;
