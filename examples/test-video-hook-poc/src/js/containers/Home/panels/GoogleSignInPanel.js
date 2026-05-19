import React, { useEffect } from 'react';
import { useGoogleSignIn } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader, DegradedBanner, useToast } from '../components/SharedUI';

export function GoogleSignInPanel() {
  const { data: user, execute, clear, isNative, loading, error } = useGoogleSignIn();
  const { push } = useToast();

  useEffect(() => {
    if (error) {
      console.error("❌ [GoogleSignInPanel] Error:", error);
      push(error.message || "Google Sign-In failed");
    }
  }, [error]);

  const statusState = loading
    ? 'loading'
    : user
      ? 'active'
      : isNative
        ? 'idle'
        : 'error';

  const statusLabel = loading
    ? 'Signing in…'
    : user
      ? `Signed in as ${user.name}`
      : isNative
        ? 'Native active'
        : 'Web disabled';

  return (
    <div className="col">
      <PanelHeader title="Google Sign-In" hook="useGoogleSignIn" nativeOnly />
      {!isNative && <DegradedBanner reason="Requires native Google SDK." />}
      <HookStatusBar state={statusState} label={statusLabel} source="native" />

      <div className={isNative ? "" : "degraded"}>
        {user ? (
          <div className="card">
            <div className="row" style={{ gap: 12 }}>
              <div className="avatar">{user.name?.[0] || 'U'}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{user.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user.email}</div>
              </div>
            </div>
            <button className="btn btn--block" style={{ marginTop: 12 }} onClick={clear} disabled={loading}>Sign Out</button>
          </div>
        ) : (
          <button 
            className="google-btn" 
            onClick={() => { 
              console.log("🔑 [GoogleSignInPanel] execute() called"); 
              execute(); 
            }}
            disabled={loading || !isNative}
          >
            {I.google()} Sign in with Google
          </button>
        )}
      </div>
    </div>
  );
}

export default GoogleSignInPanel;
