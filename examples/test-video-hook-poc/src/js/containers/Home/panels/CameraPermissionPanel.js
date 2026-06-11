import React, { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useCameraPermission } from 'catalyst-core/hooks';
import { HookStatusBar, PanelHeader, useToast } from '../components/SharedUI';

export function CameraPermissionPanel() {
  const { fallbacks, setFb } = useOutletContext();
  const fallback = fallbacks.permission;
  const setFallback = setFb('permission');
  const { permission: permStatus, isLoading, webFallbackActive, error, request } = useCameraPermission({ webFallback: fallback });
  const { push } = useToast();

  useEffect(() => {
    if (error) push(error.message || "Permission error");
  }, [error, push]);

  const perm = permStatus || 'undetermined';
  const cls = perm === 'granted' ? 'state--granted' : perm === 'denied' ? 'state--denied' : 'state--undetermined';

  return (
    <div className="col">
      <PanelHeader title="Camera Permission" hook="useCameraPermission" fallback={fallback} onFallbackChange={setFallback} />
      <HookStatusBar state={isLoading ? 'loading' : perm === 'granted' ? 'active' : perm === 'denied' ? 'error' : 'idle'} label={`State: ${perm}`} source={webFallbackActive ? 'web' : 'native'} />

      <div className="card">
        <div className="state-display">
          <span className={`state-display__big ${cls}`}>{perm}</span>
          <span className="state-display__sub">Permissions API · camera</span>
        </div>
      </div>

      {webFallbackActive && (
        <button 
          className="btn btn--block btn--primary" 
          onClick={request} 
          disabled={isLoading}
        >
          Request Permission
        </button>
      )}
    </div>
  );
}

export default CameraPermissionPanel;
