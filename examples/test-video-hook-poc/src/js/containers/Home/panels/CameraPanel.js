import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useCamera } from 'catalyst-core/hooks';
import { I, HookStatusBar, useToast, PanelHeader, Lightbox } from '../components/SharedUI';

export function CameraPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.camera;
  const setFallback = setFb('camera');
  const { data, loading, error, execute, clear, webFallbackActive } = useCamera({ webFallback: fallback });
  const { push } = useToast();

  const [photos, setPhotos] = useState([]);
  const [viewing, setViewing] = useState(null);

  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    if (error) push(error.message || "Camera error");
  }, [error, push]);

  // Sync captured photo from useCamera hook
  useEffect(() => {
    if (data) {
      const dataUrl = data.fileSrc || data.uri || `data:${data.mimeType || 'image/jpeg'};base64,${data.base64}`;
      const name = data.fileName || `photo-${Date.now()}.jpg`;
      const size = data.size || data.fileSize || 0;
      const type = data.mimeType || data.type || 'image/jpeg';
      
      setPhotos(prev => {
        // Prevent duplicate addition of the same captured item
        if (prev.some(p => p.url === dataUrl || (p.name === name && p.size === size))) {
          return prev;
        }
        const photo = {
          id: Math.random().toString(36).slice(2),
          url: dataUrl,
          name,
          size,
          type,
          ts: new Date(),
        };
        return [photo, ...prev];
      });
    }
  }, [data]);

  // Clean up Object URLs on unmount
  useEffect(() => {
    return () => {
      photosRef.current.forEach(p => {
        if (p.url && p.url.startsWith('blob:')) {
          URL.revokeObjectURL(p.url);
        }
      });
    };
  }, []);

  const removePhoto = (id) => {
    setPhotos(prev => {
      const p = prev.find(x => x.id === id);
      if (p && p.url && p.url.startsWith('blob:')) {
        URL.revokeObjectURL(p.url);
      }
      return prev.filter(x => x.id !== id);
    });
    // If we removed the active hook data photo, clear the hook state too
    if (data) {
      const currentUrl = data.fileSrc || data.uri || `data:${data.mimeType || 'image/jpeg'};base64,${data.base64}`;
      const p = photos.find(x => x.id === id);
      if (p && p.url === currentUrl) {
        clear();
      }
    }
  };

  const clearAll = () => {
    photos.forEach(p => {
      if (p.url && p.url.startsWith('blob:')) {
        URL.revokeObjectURL(p.url);
      }
    });
    setPhotos([]);
    setViewing(null);
    clear(); // Clear hook state
  };

  const latest = photos[0];

  const formatBytes = (n) => {
    if (!n) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  };

  return (
    <div className="col">
      <PanelHeader title="Camera" hook="useCamera" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar
        state={loading ? 'loading' : photos.length ? 'active' : 'idle'}
        label={photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Idle'}
        source={webFallbackActive ? 'web' : 'native'}
      />

      <div className="camera-stage" style={{ height: 220, cursor: latest ? 'pointer' : 'default' }} onClick={() => latest && setViewing(latest)}>
        {latest
          ? <img src={latest.url} alt="captured" />
          : (
            <div className="camera-stage__placeholder">
              <span style={{ opacity: 0.6 }}>{I.camera()}</span>
              <span>No photo yet</span>
            </div>
          )}
      </div>

      <button className="btn btn--primary btn--block btn--lg" onClick={() => { 
        console.log("📷 [CameraPanel] execute() called"); 
        if (!webFallbackActive && typeof window !== 'undefined' && !window.NativeBridge && !window.webkit?.messageHandlers?.NativeBridge) {
          push("Native bridge not available. Enable 'Web Fallback' to test in a browser.");
          return;
        }
        execute(); 
      }}>
        {I.camera()} Take Photo
      </button>

      {photos.length > 0 && (
        <div className="card" style={{ paddingBottom: 12 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <div className="card__label" style={{ margin: 0 }}>Captured ({photos.length})</div>
            <button
              className="btn btn--ghost"
              style={{ height: 26, padding: '0 8px', color: 'var(--accent-red)', fontSize: 12 }}
              onClick={clearAll}
            >Clear all</button>
          </div>
          <div className="photo-grid">
            {photos.map(p => (
              <div key={p.id} className="photo-tile" onClick={() => setViewing(p)}>
                <img src={p.url} alt={p.name} />
                <button
                  className="photo-tile__x"
                  aria-label="Remove"
                  onClick={(e) => { e.stopPropagation(); removePhoto(p.id); }}
                >{I.x()}</button>
              </div>
            ))}
          </div>
          {latest && (
            <div className="card__row" style={{ marginTop: 10 }}>
              <span className="card__key">Latest</span>
              <span className="card__val" style={{ fontSize: 12 }}>
                {formatBytes(latest.size)} · {latest.type}
              </span>
            </div>
          )}
        </div>
      )}

      <Lightbox
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name || 'Photo'}
        subtitle={viewing ? `${viewing.type} · ${formatBytes(viewing.size)} · ${viewing.ts.toLocaleTimeString()}` : ''}
        footer={viewing && (
          <button
            className="btn btn--danger btn--block"
            onClick={() => { removePhoto(viewing.id); setViewing(null); }}
          >{I.trash()} Delete</button>
        )}
      >
        {viewing && <img src={viewing.url} alt={viewing.name} />}
      </Lightbox>
    </div>
  );
}

export default CameraPanel;
