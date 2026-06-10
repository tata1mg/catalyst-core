import React, { useState, useEffect } from "react"
import { Navigate } from "react-router-dom"
import Home from "@containers/Home/Home"
import Profile from "@containers/Profile/Profile"
import {
  VideoStreamPanel,
  CameraPanel,
  FilePickerPanel,
  HapticPanel,
  CameraPermissionPanel,
  NetworkPanel,
  DataProtectionPanel,
  SafeAreaPanel,
  DeviceInfoPanel,
  NotificationPanel,
  GoogleSignInPanel,
  IntentPanel
} from "@containers/Home/panels"

function ClientNavigate({ to, replace }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }
  return <Navigate to={to} replace={replace} />;
}

const routes = [
    {
        path: "/",
        component: Home,
        children: [
            { path: "", element: <ClientNavigate to="/video" replace /> },
            { path: "video", component: VideoStreamPanel },
            { path: "camera", component: CameraPanel },
            { path: "files", component: FilePickerPanel },
            { path: "haptic", component: HapticPanel },
            { path: "permission", component: CameraPermissionPanel },
            { path: "network", component: NetworkPanel },
            { path: "protect", component: DataProtectionPanel },
            { path: "safe", component: SafeAreaPanel },
            { path: "device", component: DeviceInfoPanel },
            { path: "notify", component: NotificationPanel },
            { path: "google", component: GoogleSignInPanel },
            { path: "intent", component: IntentPanel },
        ]
    },
    {
        path: "/profile",
        end: true,
        component: Profile,
    },
]

export default routes
