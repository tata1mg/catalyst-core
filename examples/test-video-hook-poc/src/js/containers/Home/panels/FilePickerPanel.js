import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useFilePicker } from 'catalyst-core/hooks';
import { I, HookStatusBar, useToast, PanelHeader, Section, Switch, Lightbox, FileViewer } from '../components/SharedUI';

export function FilePickerPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.files;
  const setFallback = setFb('files');
  
  const hookReturn = useFilePicker({ webFallback: fallback });
  const { data, loading, error, execute, webFallbackActive, clear, getFileObject, getFileObjects } = hookReturn;
  
  const { push } = useToast();
  const [drag, setDrag] = useState(false);

  const [files, setFiles] = useState([]);
  const [viewing, setViewing] = useState(null);

  // pick options
  const [mimeType, setMimeType] = useState('*/*');
  const [multiple, setMultiple] = useState(true);
  const [minFiles, setMinFiles] = useState('');
  const [maxFiles, setMaxFiles] = useState('');
  const [minSize, setMinSize] = useState('');
  const [maxSize, setMaxSize] = useState('');

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (error) push(error.message || "File picker error");
  }, [error, push]);

  // Synchronize hook state data with local state for custom interactive removals
  useEffect(() => {
    if (data) {
      const list = Array.isArray(data) ? data : [data];
      setFiles(prevFiles => {
        return list.map((f, i) => {
          const existing = prevFiles.find(x => x.fileName === (f.fileName || f.name) && x.size === (f.fileSize || f.size));
          let url = existing?.url;
          if (!url) {
            if (f.fileSrc || f.uri) {
              url = f.fileSrc || f.uri;
            } else if (f instanceof File) {
              url = URL.createObjectURL(f);
            } else if (f.fileObject instanceof File) {
              url = URL.createObjectURL(f.fileObject);
            } else if (f._file instanceof File) {
              url = URL.createObjectURL(f._file);
            }
          }
          return {
            id: existing?.id || Math.random().toString(36).slice(2),
            fileName: f.fileName || f.name || `file-${i}`,
            mimeType: f.type || f.mimeType || 'unknown',
            size: f.fileSize || f.size || 0,
            transport: f.transport || 'OBJECT_URL',
            url: url,
            canCreate: !!getFileObject,
            _file: f.fileObject || f._file || (f instanceof File ? f : null)
          };
        });
      });
    } else {
      setFiles([]);
    }
  }, [data, getFileObject]);

  // Clean up Object URLs on unmount
  useEffect(() => {
    return () => {
      filesRef.current.forEach(f => {
        if (f.url && f.url.startsWith('blob:')) {
          URL.revokeObjectURL(f.url);
        }
      });
    };
  }, []);

  const removeFile = (id) => {
    setFiles(prev => {
      const f = prev.find(x => x.id === id);
      if (f && f.url && f.url.startsWith('blob:')) {
        URL.revokeObjectURL(f.url);
      }
      return prev.filter(x => x.id !== id);
    });
  };

  const handleClear = () => {
    files.forEach(f => {
      if (f.url && f.url.startsWith('blob:')) {
        URL.revokeObjectURL(f.url);
      }
    });
    setFiles([]);
    clear();
  };

  const formatBytes = (n) => {
    if (!n) return '0 B';
    const units = ['B','KB','MB','GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  };

  const extName = (name) => {
    const m = /\.([^.]+)$/.exec(name);
    return (m ? m[1] : 'file').slice(0, 4).toUpperCase();
  };

  const sanitizeOptions = () => {
    const opts = {};
    if (mimeType && mimeType !== '*/*') opts.mimeType = mimeType;
    opts.multiple = !!multiple;
    const numFields = { minFiles, maxFiles, minFileSize: minSize, maxFileSize: maxSize };
    for (const [k, v] of Object.entries(numFields)) {
      if (v === '' || v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${k}: ${v}`);
      opts[k] = n;
    }
    if (opts.minFiles != null && opts.maxFiles != null && opts.minFiles > opts.maxFiles) {
      throw new Error('minFiles must be ≤ maxFiles');
    }
    if (opts.minFileSize != null && opts.maxFileSize != null && opts.minFileSize > opts.maxFileSize) {
      throw new Error('minFileSize must be ≤ maxFileSize');
    }
    return opts;
  };

  const pick = () => {
    let opts;
    try {
      opts = sanitizeOptions();
    } catch (e) {
      push(e.message);
      return;
    }
    execute(opts);
  };

  const handleGetFileObject = async (idx) => {
    if (getFileObject) {
      try {
        const fileObj = await getFileObject(idx);
        push(`Got File: ${fileObj.name} (${formatBytes(fileObj.size)})`);
      } catch (err) {
        push(err.message || "Failed to reconstruct file");
      }
    } else {
      push("getFileObject not supported by this version of catalyst-core");
    }
  };

  const handleGetAllFileObjects = async () => {
    if (getFileObjects) {
      try {
        const fileObjs = await getFileObjects();
        push(`Got ${fileObjs.length} File objects`);
      } catch (err) {
        push(err.message || "Failed to reconstruct files");
      }
    } else {
      push("getFileObjects not supported by this version of catalyst-core");
    }
  };

  const transportClass = (t) =>
    t === 'OBJECT_URL'      ? 'pill--blue'
    : t === 'BRIDGE_BASE64' ? 'pill--orange'
    :                         'pill--green';

  return (
    <div className="col">
      <PanelHeader title="File Picker" hook="useFilePicker" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state={loading ? 'loading' : files.length ? 'active' : error ? 'error' : 'idle'} label={files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Idle'} source={webFallbackActive ? 'web' : 'native'} />

      <Section title="Options">
        <div className="col" style={{ gap: 4 }}>
          <div className="field">
            <div className="field__label">MIME type
              <div className="field__hint">e.g. <span className="kbd">image/*</span>, <span className="kbd">application/pdf</span></div>
            </div>
            <input className="input input--mono" style={{ width: 130, height: 32 }} value={mimeType} onChange={e => setMimeType(e.target.value)} />
          </div>
          <div className="field">
            <div className="field__label">Multiple
              <div className="field__hint">allow multi-selection</div>
            </div>
            <Switch on={multiple} onChange={setMultiple} label="Multiple" />
          </div>
          <div className="field">
            <div className="field__label">File count</div>
            <div className="row" style={{ gap: 6 }}>
              <input className="input input--num" type="number" min="0" placeholder="min" value={minFiles} onChange={e => setMinFiles(e.target.value)} />
              <span className="card__key">–</span>
              <input className="input input--num" type="number" min="0" placeholder="max" value={maxFiles} onChange={e => setMaxFiles(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <div className="field__label">File size (bytes)</div>
            <div className="row" style={{ gap: 6 }}>
              <input className="input input--num" type="number" min="0" placeholder="min" value={minSize} onChange={e => setMinSize(e.target.value)} style={{ width: 80 }} />
              <span className="card__key">–</span>
              <input className="input input--num" type="number" min="0" placeholder="max" value={maxSize} onChange={e => setMaxSize(e.target.value)} style={{ width: 80 }} />
            </div>
          </div>
        </div>
      </Section>

      <div
        className={`dropzone ${drag ? 'dropzone--active' : ''}`}
        onClick={pick}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); }}
      >
        {I.upload()}
        <div style={{ fontWeight: 600, fontSize: 14 }}>Tap to pick file</div>
        <div className="dropzone__hint">or drop files here</div>
      </div>

      {files.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="spread" style={{ padding: '8px 12px 4px' }}>
            <div className="card__label" style={{ margin: 0 }}>Selected files ({files.length})</div>
            <button className="btn btn--ghost" style={{ height: 28, padding: '0 8px', color: 'var(--accent-red)', fontSize: 13 }} onClick={handleClear}>Clear all</button>
          </div>
          {files.map((f, idx) => (
            <div key={f.id} className="file-row" style={{ flexWrap: 'wrap', rowGap: 6 }} onClick={() => setViewing(f)}>
              <div className="file-row__icon">{extName(f.fileName)}</div>
              <div className="file-row__main">
                <div className="file-row__name">{f.fileName}</div>
                <div className="file-row__meta">{f.mimeType} · {formatBytes(f.size)}</div>
              </div>
              <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <span className={`pill ${transportClass(f.transport)}`}>{f.transport}</span>
                {f.canCreate && (
                  <button
                    className="btn btn--ghost"
                    style={{ height: 24, padding: '0 8px', fontSize: 11, color: 'var(--accent-blue)' }}
                    onClick={(e) => { e.stopPropagation(); handleGetFileObject(idx); }}
                  >Get JS File</button>
                )}
              </div>
              <button
                className="file-row__remove"
                aria-label="Remove"
                onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
              >{I.x()}</button>
            </div>
          ))}
          {getFileObjects && files.length > 1 && (
            <div style={{ padding: '8px 12px 12px' }}>
              <button className="btn btn--block" onClick={handleGetAllFileObjects}>Get All as File Objects</button>
            </div>
          )}
        </div>
      )}

      <Lightbox
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.fileName || 'File'}
        subtitle={viewing ? `${viewing.mimeType} · ${formatBytes(viewing.size)} · ${viewing.transport}` : ''}
      >
        {viewing && (
          <FileViewer file={{
            url: viewing.url,
            name: viewing.fileName,
            type: viewing.mimeType,
            size: viewing.size,
            file: viewing._file,
          }} />
        )}
      </Lightbox>
    </div>
  );
}

export default FilePickerPanel;
