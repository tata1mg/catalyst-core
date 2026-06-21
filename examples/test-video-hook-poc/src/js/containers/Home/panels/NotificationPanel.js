import React, { useState } from 'react';
import { useNotification } from 'catalyst-core/hooks';
import { I, HookStatusBar, PanelHeader, DegradedBanner } from '../components/SharedUI';

export function NotificationPanel() {
  const { permissionStatus, requestPermission, schedule, isNative } = useNotification();
  const [title, setTitle] = useState('Catalyst bridge');
  const [body, setBody] = useState('Tap to verify native delivery.');

  const handleSend = () => {
    console.log("🔔 [NotificationPanel] Sending test notification:", title);
    schedule({ title, body, id: Math.random().toString() });
  };

  return (
    <div className="col">
      <PanelHeader title="Notification" hook="useNotification" nativeOnly />
      {!isNative && <DegradedBanner reason="Requires Service Worker + push, not available in WebView." />}
      <HookStatusBar state={isNative ? 'active' : 'error'} label={isNative ? 'Native active' : 'Web disabled'} source="native" />

      <div className={isNative ? "" : "degraded"}>
        <div className="card">
          <div className="state-display" style={{ padding: '16px 12px' }}>
            <span className="state-display__big state--undetermined">{permissionStatus || 'undetermined'}</span>
            <span className="state-display__sub">Notification.permission</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--primary grow" onClick={requestPermission}>Request Permission</button>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__label">Send test</div>
          <div className="col">
            <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="input" rows="2" placeholder="Body" value={body} onChange={e => setBody(e.target.value)} />
            <button className="btn btn--success btn--block" onClick={handleSend}>
              {I.bell()} Send Test Notification
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotificationPanel;
