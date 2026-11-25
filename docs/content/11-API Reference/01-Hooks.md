---
title: Hooks
slug: hooks
id: hooks
---

# Hooks

Catalyst exposes two groups of hooks:

- route data hooks (`useRouterData`, `useCurrentRouteData`) and `useRouterState` from `catalyst-core`
- React Router hooks (`useParams`, `useNavigate`, `useLocation`, and the rest) from `react-router`,
  which Catalyst declares as a peer dependency
- native or universal app hooks from `catalyst-core/hooks`

## Hooks Overview

| Hook / API | Description | Web | iOS | Android |
|------------|-------------|-----|-----|---------|
| `useRouterData` | Access data for all matched routes | Yes | Yes | Yes |
| `useCurrentRouteData` | Access current route fetcher state and data | Yes | Yes | Yes |
| `useRouterState` | Read location, params, `navigate` and matched routes through Catalyst's router context | Yes | Yes | Yes |
| `getDeviceInfo` | Read device, screen, and app metadata from the bridge | Yes | Yes | Yes |
| `useCamera` | Capture media via the bridge or web fallback | Partial | Yes | Yes |
| `useFilePicker` | Select files and normalize results | Partial | Yes | Yes |
| `useIntent` | Open files or URLs with external apps | No | Yes | Yes |
| `useGoogleSignIn` | Trigger Google sign-in through the native shell | No | Yes | Yes |
| `useCameraPermission` | Check and request camera permission | Partial | Yes | Yes |
| `useNotificationPermission` | Check and request notification permission | No | Yes | Yes |
| `useHapticFeedback` | Trigger haptic feedback with platform-aware behavior | No | Yes | Yes |
| `useNotification` | Schedule local notifications and manage push setup | No | Yes | Yes |
| `useNetworkStatus` | Read online status and network type | Yes | Yes | Yes |
| `useDataProtection` | Use native data protection and encryption helpers | No | Yes | Yes |
| `useSafeArea` | Read native safe-area insets | Yes | Yes | Yes |
| `useAI` | Generate text via cloud, native on-device, or in-browser models | Partial | Yes | Yes |
| `useVision` | Read an image into typed data, on the device when it can | Partial | Yes | Yes |

`Partial` means behavior depends on browser support or fallback behavior in the web environment.

### Requirements and fallbacks

What each hook needs, what you get when it is missing, and what it falls back to. In a plain browser without `WebBridge`, hooks that
register native callbacks throw when `WebBridge` is not initialized (call `WebBridge.init()` at startup, as the app shell does); hooks
marked "renders" never throw and report `isNative: false` / `isWeb: true`.

| Hook | Needs | Without it | Web fallback |
|------|-------|------------|--------------|
| `useCamera`, `useCameraPermission` | Native bridge for the native camera | Renders; `isWeb: true`, native calls dispatch nothing | Browser capture where supported (`Partial`) |
| `useFilePicker` | Native bridge for the native picker | Renders; `isWeb: true` | Hidden file input; `fileSrc` is an object URL |
| `useHapticFeedback` | Native bridge | Renders; `isAvailable: false`; `execute` rejects `Native bridge not available` | None |
| `useIntent`, `useGoogleSignIn` | Native shell and `WebBridge` | Throws `WebBridge is not initialized` during render | None |
| `useNotification`, `useNotificationPermission` | Native shell and `WebBridge` | Throws `WebBridge is not initialized` during render | None |
| `useNetworkStatus` | Nothing (native adds the network type) | Renders; uses the browser's online state | Browser online state |
| `useDeviceInfo` | Nothing (native adds device details) | Renders; `isWeb: true` | Browser-derived info, can be turned off with `setWebFallback` |
| `useDataProtection` | Native bridge | Renders; calls do nothing on web | None |
| `useSafeArea` | Native bridge with edge-to-edge on | Renders; insets are `0` | `0` insets |
| `useVideoStream` | Native bridge for native preview | Renders; `isWeb: true` | Browser camera stream (`mediaStream`) |
| `useNativeTransition` | A router (`<Router>`) | Throws if there is no router | Plain navigation |
| `useMicrophone` | Microphone permission; the native shell adds the permission prompt | Renders; `supported: false` when the browser cannot record | Browser `getUserMedia` |
| `useSpeechRecognition` | The native app | Renders; `supported: false` | None |
| `useAI`, `useVision`, `useTranscribe`, `useAgent` | `catalyst-ai` | `error` is a registry error with code `AI-010` that says `npm install catalyst-ai`; the action (`generate`, `scan`, `transcribe`, `run`) returns that error | Depends on the provider: see [Choosing a Hook](/content/Catalyst%20AI/choosing-a-hook) |
| `useImageGen`, `useSpeech`, `useLiveTranscribe` | `catalyst-ai` | `error` is a plain string that says `npm install catalyst-ai`; `generate` / `speak` resolve with that string in `error` | Depends on the provider |
| `requestImage`, `requestSpeech` | `catalyst-ai` | The call rejects with the `AI-010` error | None |

A missing requirement is either a documented throw (the rows above that throw) or an `error` value with a message that says what to do.

## Route Hooks

### `useRouterData`

The `useRouterData` hook provides access to the data for all matched routes.

#### Import

```javascript
import { useRouterData } from "catalyst-core";
```

#### Return Value

Returns an object containing data for all active routes, keyed by route path.

#### Usage

```javascript
import { useRouterData } from "catalyst-core";

const Layout = () => {
  const routerData = useRouterData();
  // { "/dashboard": { data, error, ... }, "/dashboard/settings": { data, error, ... } }
};
```

### `useCurrentRouteData`

`useCurrentRouteData` provides access to the data resolved by `serverFetcher` or `clientFetcher` for the current route.

#### Import

```javascript
import { useCurrentRouteData } from "catalyst-core";
```

#### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `data` | `any` | The data returned by the fetcher function. |
| `error` | `Error` | An error object if the fetcher function throws an error. |
| `isFetching` | `boolean` | A boolean indicating if a fetch is in progress. |
| `isFetched` | `boolean` | A boolean indicating if a fetch has completed. |
| `refetch` | `function` | A function to re-run the `clientFetcher`. |
| `clear` | `function` | A function to clear the cached data for the current route. |

#### Requirements

This hook only works inside the `RouterDataProvider` tree. If the app is not wrapped in `RouterDataProvider`, the hook returns `undefined`.

#### Usage

```javascript
import { useCurrentRouteData } from "catalyst-core";

const ProductPage = () => {
  const { data, error, isFetching, isFetched, refetch, clear } = useCurrentRouteData();

  return (
    <div>
      {isFetching && <Spinner />}
      {error && <Error message={error.message} />}
      {data && <ProductDetails product={data} />}
    </div>
  );
};
```

#### `refetch`

The `refetch` function can be used to re-run the `clientFetcher` for the current route.

```javascript
const ProductList = () => {
  const { data, refetch } = useCurrentRouteData();
  const [page, setPage] = useState(1);

  useEffect(() => {
    refetch({ page });
  }, [page]);

  return <div>...</div>;
};

ProductList.clientFetcher = async ({ params }, { store }, { page = 1 }) => {
  const response = await fetch(`/api/products?page=${page}`);
  return response.json();
};
```

#### `clear`

The `clear` function can be used to remove the cached data for the current route.

```javascript
const { clear } = useCurrentRouteData();

useEffect(() => {
  return () => clear();
}, []);
```

### `useRouterState`

Added in `1.0.2`. `useRouterState` returns the current router state through Catalyst's own router context instead of React Router's hooks. `catalyst-core/webmcp` uses it so that code loaded from a `catalyst-core` subpath reads the same router state as the app, even when the dev server resolves a separate copy of `react-router` for that subpath.

In application components, keep using `useLocation`, `useParams` and `useNavigate` from `react-router`. Reach for `useRouterState` in code that cannot import `react-router` itself.

#### Import

```javascript
import { useRouterState } from "catalyst-core";
```

#### Return Value

`{ location, params, navigate, matchedRoutes }`: the current location, the params of the deepest matched route (`{}` when there are none), React Router's `navigate` function, and the matched route chain (`[]` when nothing matched).

It throws `useRouterState must be used within a RouterDataProvider` when called outside `RouterDataProvider`.

## Universal App Hooks

Import universal hooks from `catalyst-core/hooks`:

```javascript
import {
  useCamera,
  useFilePicker,
  useIntent,
  useGoogleSignIn,
  useCameraPermission,
  useNotificationPermission,
  useHapticFeedback,
  useNotification,
  useNetworkStatus,
  useDataProtection,
  useSafeArea,
  useDeviceInfo,
  useVideoStream,
  useNativeTransition,
} from "catalyst-core/hooks";
```

Native hooks fall into three categories. Which category a hook belongs to determines whether it has an `execute` function.

### Single-action hooks

A hook that wraps exactly one native operation exposes that operation as `execute`, plus a domain-specific alias for the same function, plus state:

- `execute` — start the operation
- `data` — result payload, `null` until the operation completes
- `loading` — operation in progress
- `error` — standardized error object, `null` when there is no error
- `progress` — progress detail during the operation, where the platform reports it
- `isWeb` / `isNative` — runtime context
- `clear` — reset data and error
- `clearError` — reset error only

`execute` takes the operation's own arguments. It never takes an operation name.

| Hook | Domain alias for `execute` |
|------|----------------------------|
| `useCamera` | `takePhoto` |
| `useFilePicker` | `pickFile` |
| `useIntent` | `openFile` |
| `useGoogleSignIn` | `signIn` |
| `useHapticFeedback` | `trigger`, `triggerHaptic` |
| `useCameraPermission` | `request` |

`useHapticFeedback` also exposes one shortcut per feedback type (`light`, `medium`, `heavy`, `success`, `warning`, `errorHaptic`, `selection`, `impact`), each of which calls `execute` with that type.

### Multi-action hooks

A hook that wraps several distinct native operations has no meaningful single action, so **the named functions are the API**. These hooks do not have an `execute`:

| Hook | Named functions |
|------|-----------------|
| `useNotification` | `scheduleLocal`, `cancelLocal`, `registerForPush`, `updateBadge`, `subscribeToTopic`, `unsubscribeFromTopic`, `getSubscribedTopics`, `requestPermission` |
| `useVideoStream` | `start`, `stop`, `sendCommand`, `flip` |
| `useDataProtection` | `setScreenSecure`, `clearWebData` |
| `useNativeTransition` | `navigate`, `cancelTransition` |

Multi-action hooks still expose the shared state keys (`data`, `loading`, `error`, `isWeb`, `isNative`, `clear`, `clearError`) where they apply.

`useNotification` is the one exception: it carries an `execute` key that aliases `scheduleLocal`, kept for backward compatibility. It is frozen but discouraged, and it is **not** the pattern to copy when writing or consuming multi-action hooks. See [Aliases and Deprecations](#aliases-and-deprecations).

### Read-only hooks

`useNetworkStatus`, `useDeviceInfo`, and `useSafeArea` report ambient device state. They have no action functions at all — they return state plus the runtime-context keys.

### `getDeviceInfo`

Read device, screen, and app metadata from the native bridge. `getDeviceInfo` is exposed by `WebBridge.init()` and on `window.WebBridge`; it is not a React hook exported from `catalyst-core/hooks`.

#### Import

```javascript
import WebBridge from "catalyst-core/WebBridge";
```

#### Returns

Resolves to an object with normalized device metadata.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `string` | Device model, or the browser user agent on web |
| `manufacturer` | `string` | Device manufacturer, or `browser` on web |
| `platform` | `string` | `ios`, `android`, or `web` |
| `screenWidth` | `number` | Screen width in pixels |
| `screenHeight` | `number` | Screen height in pixels |
| `screenDensity` | `number` | Screen scale or pixel density |
| `appInfo` | `object \| string \| null` | App metadata provided by the native shell, when available |
| `security` | `object` | Android security check state, when available |

#### Usage

```javascript
const { getDeviceInfo } = WebBridge.init();

async function logDeviceInfo() {
  const deviceInfo = await getDeviceInfo();
  console.log(deviceInfo.platform, deviceInfo.model);
}
```

If the bridge is already initialized, you can also call `window.WebBridge.getDeviceInfo()`. On web, `getDeviceInfo()` resolves with browser and screen information instead of throwing.

### `useCamera`

Access camera capture through the native bridge. The hook exposes a standardized stateful interface and camera-specific aliases.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `data` | `object \| null` | Captured file payload including file data and transport metadata |
| `loading` | `boolean` | Capture or permission flow in progress |
| `error` | `object \| null` | Standardized error object |
| `progress` | `object \| null` | Progress information during the capture flow |
| `isWeb` | `boolean` | Running in a browser context |
| `isNative` | `boolean` | Running inside the native shell |
| `execute` | `function` | Primary camera action entrypoint |
| `permission` | `object` | Camera permission state |
| `takePhoto` | `function` | Semantic alias for camera capture |
| `clear` | `function` | Clear captured data and reset state |
| `clearError` | `function` | Clear error state only |

#### Usage

`takePhoto()` returns `undefined`. It hands the request to the native shell and returns immediately — do not `await` it or read a return value. The captured photo arrives asynchronously on `data`, and a failure arrives on `error`. Read both from the hook, and react to the result in an effect if you need to run code when the capture lands.

```javascript
function PhotoCapture() {
  const { takePhoto, loading, error, data, isNative } = useCamera();

  useEffect(() => {
    if (data) {
      console.log("Photo captured:", data.fileName);
    }
  }, [data]);

  return (
    <>
      <button onClick={() => takePhoto()} disabled={loading || !isNative}>
        Take Photo
      </button>
      {error && <p>{error.message}</p>}
      {data && <img src={data.fileSrc} alt="Captured" />}
    </>
  );
}
```

The same applies to `execute`, `pickFile`, `openFile`, and `signIn`: they dispatch to the native bridge and return `undefined`. `useHapticFeedback`'s `execute` is the exception — when haptics are supported it returns a promise, resolving to the raw native status string on native and to a boolean on the web vibration fallback. When haptics are unsupported it records a `FEATURE_UNSUPPORTED` error and returns `undefined` rather than a promise, so guard on `isSupported` before awaiting.

### `useFilePicker`

Open the native file picker and receive a normalized result payload.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `data` | `object \| null` | Normalized file picker payload |
| `selectedFile` | `object \| null` | The first selected entry (the usual case for a single-file picker): `{ fileName, fileSrc, size, mimeType, transport, ... }` |
| `selectedFiles` | `array` | Selected file entries, same shape as `selectedFile` |
| `isWeb` | `boolean` | `true` when running in a plain browser and the web fallback is used |
| `loading` | `boolean` | Picker flow in progress |
| `error` | `object \| null` | Standardized error object |
| `execute` | `function` | Open the file picker |
| `pickFile` | `function` | Alias for `execute` |
| `getFileObject` | `function` | Convert one selected result into a browser `File` |
| `getAllFileObjects` | `function` | Convert all selected results into `File[]` |
| `clear` | `function` | Clear picker state |
| `clearError` | `function` | Clear error state only |

On the web fallback (`isWeb: true`) the picker is a hidden file input. `fileSrc` is then an **object URL** (`blob:...`, `transport: "OBJECT_URL"`) made from the chosen `File`, not a path or a data URL: use it for previews (`<img src>`, `<audio src>`) or read it with `fetch(fileSrc).then((r) => r.blob())`. `filePath` is `null`. In the apps, `fileSrc` and `transport` describe how the shell handed the file over; use `getFileObject()` to get a `File` either way.

#### Usage

```javascript
function FileUpload() {
  const { pickFile, getAllFileObjects, loading } = useFilePicker();

  const handleSelectFile = async () => {
    pickFile({ mimeType: "application/pdf", multiple: true, maxFiles: 3 });
  };

  return <button onClick={handleSelectFile} disabled={loading}>Select File</button>;
}
```

### `useHapticFeedback`

Trigger platform-specific haptic feedback with a standardized interface and semantic shortcuts.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `execute` | `(feedbackType?, options?) => Promise<string \| boolean> \| undefined` | Trigger haptic feedback. Resolves the raw native status string on native, a boolean on the web fallback; returns `undefined` when `isSupported` is `false` |
| `isSupported` | `boolean` | Haptics available on device |
| `light` | `function` | Light feedback shortcut |
| `medium` | `function` | Medium feedback shortcut |
| `heavy` | `function` | Heavy feedback shortcut |
| `success` | `function` | Success feedback shortcut |
| `warning` | `function` | Warning feedback shortcut |
| `errorHaptic` | `function` | Error feedback shortcut |

#### Usage

```javascript
function FeedbackButton() {
  const { medium } = useHapticFeedback();

  return <button onClick={() => medium()}>Submit</button>;
}
```

### `useIntent`

Open a file with an external native app, or open a web link outside the app.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `openFile` | `function` | Open a file URL with an external app, with an optional MIME type |
| `execute` | `function` | Alias of `openFile` |
| `openInBrowser` | `function` | Open an `http` or `https` URL outside the WebView |
| `success` | `boolean \| null` | `true` once the last call opened its target |
| `loading` | `boolean` | Intent flow in progress |
| `error` | `object \| null` | Standardized error object |
| `isNative` | `boolean` | Running inside the native shell |
| `clear` | `function` | Clear result state |
| `clearError` | `function` | Clear error state only |

#### Usage

```javascript
function OpenInvoiceButton({ url }) {
  const { execute, loading } = useIntent();

  return (
    <button onClick={() => execute(url, "application/pdf")} disabled={loading}>
      Open Invoice
    </button>
  );
}
```

`openInBrowser(url)` hands the link to the system, which opens it in the default browser, or in the app that owns the link when one is installed (an Android app link or an iOS universal link). Only `http` and `https` URLs are accepted. Any other scheme, such as `tel:` or `file:`, does nothing and sets `error`. On the web it does nothing; use a normal link there.

```javascript
function TermsLink() {
  const { openInBrowser, isNative } = useIntent();

  if (!isNative) return <a href="https://example.com/terms">Terms</a>;
  return <button onClick={() => openInBrowser("https://example.com/terms")}>Terms</button>;
}
```

### `useCameraPermission`

Check or request camera permission through the native bridge.

```javascript
function CameraPermissionButton() {
  const { permission, isLoading } = useCameraPermission();

  return <button disabled={isLoading}>Camera permission: {permission || "checking"}</button>;
}
```

### `useNotificationPermission`

Check or request notification permission before registering for push notifications.

```javascript
function NotificationPermissionButton() {
  const { permission, isLoading } = useNotificationPermission();

  return <button disabled={isLoading}>Notification permission: {permission || "checking"}</button>;
}
```

### `useNotification`

Manage local notifications and push registration from one hook.

#### Returns

| Method | Type | Description |
|--------|------|-------------|
| `data` | `object \| null` | Latest notification result data |
| `loading` | `boolean` | Notification operation in progress |
| `error` | `object \| null` | Standardized error object |
| `permissionStatus` | `string` | Notification permission status |
| `pushToken` | `string \| null` | Current push token when available |
| `scheduleLocal` | `function` | Schedule a local notification |
| `cancelLocal` | `function` | Cancel a scheduled local notification |
| `registerForPush` | `function` | Register for push notifications |
| `subscribeToTopic` | `function` | Subscribe to a notification topic |
| `unsubscribeFromTopic` | `function` | Unsubscribe from a notification topic |
| `getSubscribedTopics` | `function` | Read current topic subscriptions |

#### Usage

```javascript
function NotificationExample() {
  const { scheduleLocal, registerForPush, subscribeToTopic } = useNotification();

  return (
    <>
      <button onClick={() => scheduleLocal({ title: "Hey!", body: "You got a message" })}>
        Send Local Notification
      </button>
      <button onClick={() => { registerForPush(); subscribeToTopic("news"); }}>
        Enable Push Notifications
      </button>
    </>
  );
}
```

#### Requirements

Push-related notification features require `WEBVIEW_CONFIG.notifications.enabled = true` and the relevant Firebase platform files in the native projects.

### `useGoogleSignIn`

Trigger Google sign-in through the native shell.

```javascript
function GoogleLoginButton() {
  const { signIn, loading, error } = useGoogleSignIn();

  return <button onClick={signIn} disabled={loading}>Continue with Google</button>;
}
```

### `useNetworkStatus`

Read connectivity state from the native bridge, with a browser fallback.

| Property | Type | Description |
|----------|------|-------------|
| `online` | `boolean` | Current connectivity state |
| `type` | `string \| null` | Network type such as `wifi` or `cellular` |
| `error` | `string \| null` | Connectivity error, if any |

```javascript
function ConnectivityBanner() {
  const { online, type } = useNetworkStatus();

  if (online) return null;
  return <div>Offline{type ? ` (${type})` : ""}</div>;
}
```

### `useDataProtection`

Use native data protection and encryption helpers exposed through the bridge.

```javascript
function ProtectedAction() {
  const { setScreenSecure, loading } = useDataProtection();

  return <button onClick={() => setScreenSecure(true)} disabled={loading}>Protect Screen</button>;
}
```

### `useSafeArea`

Read safe-area insets in CSS pixels. Values are `0` when `WEBVIEW_CONFIG.edgeToEdge.enabled` is off, and on web and SSR.

| Property | Type | Description |
|----------|------|-------------|
| `top` | `number` | Top inset |
| `right` | `number` | Right inset |
| `bottom` | `number` | Bottom inset |
| `left` | `number` | Left inset |

```javascript
function ScreenShell({ children }) {
  const safeArea = useSafeArea();

  return <main style={{ paddingTop: safeArea.top }}>{children}</main>;
}
```

`useSafeArea` has no `error` key. Insets always resolve to numbers, falling back to `0`.

### `useDeviceInfo`

Read device, screen, and app metadata as React state. This is the hook form of `WebBridge.getDeviceInfo()` documented above — the hook fetches on mount and re-renders when the result arrives, while `getDeviceInfo()` is a one-shot promise you call yourself.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `data` | `object \| null` | Device metadata payload, `null` until it resolves |
| `deviceInfo` | `object \| null` | Alias for `data` |
| `loading` | `boolean` | `true` until the metadata resolves or fails |
| `error` | `string \| null` | Failure reason — a **string**, not a standard error object |
| `isNative` | `boolean` | Running inside the native shell |
| `isWeb` | `boolean` | Running in a browser context |
| `webFallbackActive` | `boolean` | Serving browser-derived metadata instead of native |
| `webFallbackDisabled` | `boolean` | On web with the fallback turned off |
| `setWebFallback` | `function` | Enable or disable the web fallback at runtime |

The `data` payload carries the same fields as `getDeviceInfo()`: `model`, `manufacturer`, `platform`, `screenWidth`, `screenHeight`, `screenDensity`, and `appInfo`. On web, the fallback derives them from `navigator.userAgent`, `screen`, and `window.devicePixelRatio`, with `manufacturer` set to `browser` and `platform` set to `web`.

#### Usage

```javascript
function DeviceBadge() {
  const { data, loading, error } = useDeviceInfo();

  if (loading) return <span>Detecting device…</span>;
  if (error) return <span>Device info unavailable: {error}</span>;

  return <span>{data.platform} · {data.model}</span>;
}
```

### `useVideoStream`

Run a live camera preview through the native bridge, with QR detection and stream controls. This is a multi-action hook: it has no `execute`.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `isStreaming` | `boolean` | Preview is currently running |
| `streamState` | `object` | `{ zoom, minZoom, maxZoom, torchOn, fpsMin, fpsMax }` |
| `loading` | `boolean` | Start or stop in progress |
| `error` | `object \| null` | Standardized error object |
| `isNative` | `boolean` | Running inside the native shell |
| `isWeb` | `boolean` | Running in a browser context |
| `webFallbackActive` | `boolean` | Using `getUserMedia` instead of the native camera |
| `webFallbackDisabled` | `boolean` | On web with the fallback turned off |
| `setWebFallback` | `function` | Enable or disable the web fallback at runtime |
| `mediaStream` | `MediaStream \| null` | The active stream on the web fallback path, `null` on native |
| `viewfinderRef` | `ref` | Attach to the element that hosts the preview |
| `start` | `function` | Start the preview |
| `stop` | `function` | Stop the preview and release the camera |
| `sendCommand` | `function` | Send a stream command such as zoom or torch |
| `flip` | `function` | Switch between front and rear camera |
| `clearError` | `function` | Clear error state only |

On native, the preview renders behind the WebView and `viewfinderRef` marks the cut-out region; `mediaStream` stays `null`. On the web fallback, `mediaStream` holds the `getUserMedia` stream to attach to a `<video>` element.

#### Usage

```javascript
function QRScanner() {
  const { start, stop, isStreaming, viewfinderRef, error } = useVideoStream({
    onQRDetected: (value) => console.log("QR:", value),
  });

  return (
    <>
      <div ref={viewfinderRef} style={{ width: "100%", aspectRatio: "3/4" }} />
      <button onClick={() => (isStreaming ? stop() : start())}>
        {isStreaming ? "Stop" : "Scan"}
      </button>
      {error && <p>{error.message}</p>}
    </>
  );
}
```

### `useNativeTransition`

Wrap `useNavigate` with native slide and fade transitions. On native, the shell snapshots the current screen, the route swaps behind the snapshot, and the overlay animates out. On web, the same state machine drives a CSS overlay. This is a multi-action hook: it has no `execute`.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `navigate` | `(to, options?) => void` | Navigate with a transition |
| `cancelTransition` | `function` | Cancel an in-flight transition |
| `transitioning` | `boolean` | A transition is in progress |
| `loading` | `boolean` | Alias for `transitioning` |
| `isNative` | `boolean` | Running inside the native shell |
| `isWeb` | `boolean` | Running in a browser context |

`navigate` accepts the standard react-router `NavigateOptions` plus:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"slide" \| "fade"` | `"slide"` | Transition style |
| `direction` | `"left" \| "right" \| "up" \| "down"` | `"left"` | Slide direction |
| `duration` | `number` | `300` | Animation duration in ms |
| `timeout` | `number` | `max(duration * 3, 800)` | Safety timer in ms |

The same options can be passed once to the hook itself as defaults for every `navigate` call.

`useNativeTransition` has no `error` key. Transition failures self-heal: if the native start or commit fails, the hook logs, clears `transitioning`, and falls through to a plain navigation, so the user always lands on the destination route. A native-side safety timer force-fades the overlay if commit never arrives.

#### Usage

```javascript
function ProductLink({ id }) {
  const { navigate, transitioning } = useNativeTransition({ type: "slide" });

  return (
    <button onClick={() => navigate(`/product/${id}`)} disabled={transitioning}>
      View Product
    </button>
  );
}
```

## Aliases and Deprecations

Several hooks carry alias keys kept from earlier releases. Both names work and return the same value. **The aliases are removed in 2.0** — write new code against the canonical key.

| Alias | Canonical key | Hooks |
|-------|---------------|-------|
| `isLoading` | `loading` | `useCamera`, `useFilePicker`, `useIntent`, `useCameraPermission`, `useNotificationPermission` |
| `transitioning` | `loading` | `useNativeTransition` |
| `deviceInfo` | `data` | `useDeviceInfo` |
| `permission` | `data` | `useCameraPermission`, `useNotificationPermission` |
| `request` | `execute` | `useCameraPermission` |
| `photo` | `data` | `useCamera` |
| `clearPhoto` | `clear` | `useCamera` |
| `clearFile` | `clear` | `useFilePicker` |
| `reset` | `clear` | `useIntent` |

`useNotification.execute` and `useNotification.schedule` are aliases of `scheduleLocal`. They are frozen for compatibility but discouraged, and they are **not** the pattern to copy: multi-action hooks expose their named functions as the API and do not define `execute`. `useNotification` is the sole exception, for historical reasons.

### Error shapes

`error` is a `CatalystError` from the framework-wide error registry everywhere, with the exception of two hooks. Native hook failures carry a `RUNTIME-NATIVE-*` code, a human-readable `message`, a `category`, a `suggestedAction`, a `docUrl`, and the originating platform error as `cause`. See the error handling guide for the registry itself.

| Hook | `error` type | Notes |
|------|--------------|-------|
| `useDeviceInfo` | `string \| null` | Stays a string until 2.0 |
| `useNetworkStatus` | `string \| null` | Stays a string until 2.0 |

`useNativeTransition` and `useSafeArea` are error-exempt: neither returns an `error` key at all. Transition failures self-heal into a plain navigation, and safe-area insets always resolve to numeric defaults.

`useAI`'s and `useVision`'s shapes are owned by the `catalyst-ai` package and are outside this contract, but their errors are registry errors too (`AI-0xx`; see [AI Hooks](/content/Catalyst%20AI/choosing-a-hook)).

### Hooks and bridge methods with the same name

`requestHapticFeedback` and `requestCameraPermission` exist both as functions exported from `catalyst-core/hooks` and as methods on `WebBridge`. They are not the same function: the defaults and return types differ.

**`requestHapticFeedback`**

| | `catalyst-core/hooks` export | `WebBridge.requestHapticFeedback` |
|--|------------------------------|-----------------------------------|
| Default argument | `"light"` | `"VIRTUAL_KEY"` |
| Resolves with | The raw status string | The parsed result object |
| During SSR | `Promise<null>` | Not available — `window.WebBridge` does not exist |
| Bridge unavailable | Rejects `Native bridge not available` | Rejects on the bridge's own timeout |
| Uninitialized bridge | Throws synchronously | N/A |

**`requestCameraPermission`**

| | `catalyst-core/hooks` export | `WebBridge.requestCameraPermission` |
|--|------------------------------|-------------------------------------|
| Arguments | none | `config` object, e.g. `{ includeDetails: true }` |
| Resolves with | The status string, only when granted | The parsed result object, whatever the status |
| On denial | Rejects `Camera permission denied` | Resolves with the denied status |
| During SSR | `Promise<null>` | Not available — `window.WebBridge` does not exist |
| Uninitialized bridge | Throws synchronously | N/A |

Prefer the `catalyst-core/hooks` exports in application code: they are SSR-safe and treat denial as a rejection. Use the `WebBridge` methods when you need the full result object or the `config` argument. The two surfaces are unified in 2.0.

### `useAI`

Generate text through one of three providers, chosen with the `provider` option — the hook picks the underlying implementation for you:

| `provider` | Implementation | Where it runs |
|------------|-----------------|----------------|
| `"openai"` \| `"gemini"` (default) \| `"anthropic"` | `useCloudAI` | Node server route (`POST /ai/:provider/stream` or `/generate`) |
| `"native"` | `useNativeAI`, falls back to `useCloudAI` if `window.NativeBridge` is unavailable | On-device LiteRT-LM engine, via an embedded Ktor server (`POST /framework-{sessionId}/ai/stream` or `/generate`) |
| `"transformers"` | `useWebAI` — **experimental**: in-browser inference quality and WebGPU/WASM backend selection aren't reliable yet on larger models | In-browser, via a Web Worker running Transformers.js |

#### Auto routing (`provider: "auto"`)

With `provider: "auto"`, every `generate` call picks a model from the candidates in `AI_CONFIG.routing` (config.json): on-device models per platform (`ios` and `android` in the native apps, `web-desktop`, `web-mobile` and the shared `web` list in a browser; several allowed each) and cloud provider models. A call is decided in order: **availability** (bridge, WebGPU, network, the modalities the model accepts, and whether the model lists the task the call asks for), **privacy** (may this call leave the device?), then **preference**, a score over estimated cost, latency and tokens/sec.

| `routing` key | Meaning |
|---|---|
| `policy.objective` | `balanced` (default), `cost`, `latency`, `speed` or `order`; `policy.weights` overrides the weights |
| `policy.order` | Default priority, applied left to right as sort keys. Entries: a model `id`, a group (`onDevice`, `cloud`) to put those first, or a metric: `cost` (cheapest first), `latency` (quickest first), `tps` (most tokens/sec first). Example: `["onDevice", "cost", "latency"]` = on-device first, then cheapest, then quickest. A later key only matters where earlier ones tie. Default `["onDevice", "cloud"]`. For a scored objective it applies to every candidate whose normalised score is within `0.02` of the best (a near-tie, not only an exact tie). With `objective: "order"` the first available candidate in this order wins; scores are still computed and returned in `route.scores`, for diagnostics only |
| `policy.constraints` | Hard limits: `maxLatencyMs`, `minTps`, `maxCostUsd` (per estimated call) |
| `policy.cloud` / `policy.cloudMedia` | `allow`, `ask` or `deny`. Defaults: `ask` for text, `deny` for image/audio |
| `policy.autoDownload` | Let the in-browser model start its large download without asking (default `false`) |
| `onDevice.<platform>[]` | `id`, `engine`/`model`/`modelPath`, `modalities`, `tasks`, and priors `ttftMs`, `tps`, `loadMs`. Platforms are `ios`, `android` (the native apps), `web-desktop` and `web-mobile` (plain browsers), and `web` (both kinds of browser). **One list is used per page:** inside a native app only `ios` / `android` is read, because the native module owns the on-device model there and no in-browser model is ever loaded; in a browser, `web-desktop` or `web-mobile` is read (a phone's browser is mobile) and `web` is the fallback when that list is absent |
| `engine` (browser lists) | `transformers` (default: Transformers.js, needs WebGPU) or `prompt-api`: **Chrome's built-in model** (the Prompt API), desktop Chrome only. It takes text, and image or audio when the entry lists them in `modalities` and Chrome supports that input (the availability check asks for exactly the inputs of the call). Chrome owns the model and its download, so there is no WebGPU requirement. Under auto routing, while Chrome still has to fetch the model the router answers `ask` and the download starts after `generateWithConsent(args, { download: true })`, which must run from a click. Used directly as `useAI({ provider: "prompt-api" })` there is no routing and no `ask`: the first `generate()` itself starts the download, so call it from a user gesture. A `prompt-api` entry under `web-mobile` is dropped. `genConfig.temperature` and `topK` are applied together (Chrome wants both), `responseConstraint` is passed through, and other settings such as token limits are ignored |
| `tasks` (on any model) | What the model can do: `text.generate`, `vision.read`, `speech.transcribe`, `speech.synthesize`, `image.generate`, `embed`. The call asks for one (`generate({ task })` or `useAI({ task })`, default `text.generate`) and models that do not list it are skipped. Leave it out and it follows from `modalities` (text → `text.generate`, image adds `vision.read`, audio adds `speech.transcribe`), so existing configs keep working |
| `AI_CONFIG.pricing` | `{ "<model>": { input, output, cachedInput?, audioInput?, perImage? } }`, USD per 1M tokens (`perImage` is USD per generated image): your own prices, used for cost metrics and cost-based routing instead of the built-in table. `audioInput` is the rate for audio input tokens; without one, audio is not priced at the text rate and the cost is reported as partial (`audioCostUnknown`). Set the token rates with `npx catalyst-ai pricing` (it lists the cloud models in your config and asks for the ones with no price; `--check` fails CI on a missing one); `perImage` is added by hand. A text model with no price anywhere counts as free; an image model with no price reports a cost of `null`. **This block is part of `AI_PUBLIC_CONFIG`, so it is visible to the browser.** Price precedence for routing: an explicit `routing.cloud[].price` first, then `AI_CONFIG.pricing[model]` when the candidate has none, then the built-in table |
| `cloud[]` | `id`, `provider`, `model`, `modalities`, priors `ttftMs`, `tps`, optional `price: { input, output }` (USD per 1M tokens; defaults to the built-in table) |

The numbers in config are starting estimates. The metrics `useAI` reports for each finished call (time to first token, tokens/sec) are averaged per model on the device and take over from the config values after a few calls. A model that is not currently loaded pays its `loadMs`, so the router does not flip between on-device models for small gains.

The result has `route`: `null` until the first `generate()` call, then the decision for the latest call, `{ action, candidate, reason, estimate, scores, skipped }`:

| `route.action` | Meaning |
|---|---|
| `"run"` | `candidate` was picked and the call ran |
| `"ask"` | Nothing ran: the only candidate needs consent (to leave the device, or to start a large download). `candidate` is the one that would run and `reason` says why |
| `"deny"` | Nothing ran and nothing may run: `skipped` lists why each candidate was ruled out |

After an `ask`, confirm with the user, then call `generateWithConsent(args, consent)`. `consent` is `{ cloud?: boolean, download?: boolean, pin?: string }`: `cloud` lets this call leave the device, `download` lets it start the model download, and `pin` is a candidate `id` to stay on (used by multi-call jobs such as the chunks of one recording; the privacy policy still applies to it). `generate(args, consent)` accepts the same second argument. `decide(args, consent?)` returns the decision without running anything; it treats the call as live microphone listening, so the phone's own speech recogniser can be chosen (this is what `useTranscribe().listen()` uses). Pass `routing` to `useAI` to override `policy` for one hook.

Requires `catalyst-ai` to be installed in the app.

#### Import

```javascript
import { useAI } from "catalyst-core/hooks";
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `string` | `"openai"`, `"gemini"`, `"anthropic"` (Claude), `"native"`, `"transformers"`, or `"auto"` (routes each call, see below). Defaults to the cloud provider configured in `AI_CONFIG.browser`. |
| `model` | `string` | Model id. Required for `transformers`; optional override for cloud/native. |
| `genConfig` | `object` | Default generation config, merged with any per-call `genConfig` passed to `generate()`. See below. |
| `systemPrompt` | `string` | System prompt prepended to every generation. |
| `sessionMode` | `string` | `"stateless"` (default) or `"stateful"` — see Stateful Sessions below. |
| `attachmentComponents` | `object` | Map of component name → `{ attrs, hint }`, enabling structured output. See Attachment Components below. |
| `routing` | `object` | With `provider: "auto"`: overrides `AI_CONFIG.routing.policy` for this hook (see Auto routing). |
| `task` | `string` | With `provider: "auto"`: what the calls ask for (default `"text.generate"`). A task named in `generate({ task })` wins. `generate()` runs `text.generate`, `vision.read` and `speech.transcribe`; image, speech-out and embedding tasks have their own calls. |

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `output` | `string` | Accumulated generation text so far. |
| `streaming` | `boolean` | `true` while SSE tokens are actively arriving. |
| `loading` | `boolean` | `true` while a request is in flight (covers both the stream and non-stream paths). |
| `error` | `Error \| null` | Error from the last `generate()` call, if any. |
| `generate` | `function` | `generate({ messages, genConfig })` — triggers a request. `messages` is `[{ role, content }, ...]`, where `content` is a string or an array of content parts (see Images and audio). With `provider: "auto"` it also takes `(args, consent)` and the result carries `route`. |
| `route` | `object \| null` | `provider: "auto"` only: `null` until the first call, then the latest routing decision (see Auto routing). |
| `generateWithConsent` | `function` | `provider: "auto"` only: `generateWithConsent(args, { cloud, download, pin })` replays a call after `route.action` was `"ask"`. |
| `decide` | `function` | `provider: "auto"` only: the routing decision for a live-listening call, without running anything. |
| `cancel` | `function` | Abort the in-flight generation. |
| `reset` | `function` | Clear output, error, and conversation state; ends the current session. |
| `clearError` | `function` | Clear `error` only. |
| `conversationId` | `string \| null` | Present when `sessionMode="stateful"` — see below for what it means per provider. |
| `isLocal` / `isNative` / `isWeb` | `boolean` | Indicates which provider actually served the request. |
| `modelReady` | `boolean` | For `native`/`transformers`: `false` while the model is downloading or the engine is initializing. |
| `downloadProgress` | `object \| null` | For `transformers`: `{ file, percent, status }`. |
| `nativeDownloadProgress` | `object \| null` | For `native`: `{ phase, percent, detail }`. `phase` is `"lookup"` (finding the model), `"cache"` (checking what is already on the device), `"download"`, `"paused"` (waiting, see `downloadPauseReason`) or `"engine_init"` (loading the model into the engine). |
| `downloadPaused` | `boolean` | `true` while a model download waits (offline, weak link or after an error) and will resume by itself. For `native` and `transformers`. |
| `downloadPauseReason` | `"offline" \| "weak" \| "error" \| null` | Why it is waiting. |
| `nativeLogs` | `string[]` | For `native`: recent native-side log lines. |
| `metrics` | `object \| null` | Per-generation metrics from the most recent call — shape differs per provider, see below. |
| `getSessionMetrics` | `function` | Returns an aggregate across every generation this session, or `null` if none yet. |
| `resetSessionMetrics` | `function` | Clears the accumulated metrics history, without touching output or conversation state. |

#### Usage

```javascript
function Summarizer() {
  const { generate, output, streaming, loading, error } = useAI({
    provider: "openai",
    genConfig: { temperature: 0.3, maxTokens: 512 },
  });

  const handleSummarize = (document) => {
    generate({ messages: [{ role: "user", content: `Summarize: ${document}` }] });
  };

  return (
    <div>
      <button onClick={() => handleSummarize(doc)} disabled={loading}>Summarize</button>
      {streaming && <Spinner />}
      {error && <p>{error.message}</p>}
      {output && <p>{output}</p>}
    </div>
  );
}
```

#### Images and audio (content parts)

`content` may be a string or an array of parts. Text-only calls behave exactly as before.

```javascript
generate({
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What is on this label?" },
      { type: "image", data: "data:image/jpeg;base64,..." },   // image/png, jpeg, webp (OpenAI and Anthropic also gif)
      { type: "audio", data: "data:audio/wav;base64,..." },    // see the provider table for formats
    ],
  }],
});
```

- **Limits.** Per request: up to 4 images and 2 audio clips, images up to 8 MB and audio up to 10 MB each (decoded), and 14 MiB of media in total (base64 inflates it by a third, which keeps the request under the 20 MB body limit). The cloud route checks them again; a request over the limit fails with a typed error (`too-many`, `too-large`, `invalid-part`, `unsupported-modality`, `unsupported-format`). `catalyst-core` raises the JSON body limit to 20 MB on the AI path only (`AI_CONFIG.maxRequestMB`, 1 to 100).
- **Cloud needs an explicit choice.** `useAI({ provider: "openai" | "gemini" | "anthropic" })` may send media to that provider. If you asked for a native or web engine and it is unavailable, `useAI` falls back to cloud for text only and refuses media with `cloud-media-not-allowed`, so a photo or voice clip never leaves the device by accident. With `provider: "auto"` the same rule is `policy.cloudMedia` (default `deny`).
- **What each provider endpoint accepts** (anything else is refused with `unsupported-modality` before any provider call):

| Endpoint | Images | Audio | PDF (`{ type: "document" }`, server side) |
|---|---|---|---|
| OpenAI Chat Completions | yes | wav, mp3 on `*audio*` models | no |
| OpenAI Responses (`sessionMode: "stateful"`) | yes | no | no |
| Gemini `generateContent` | yes | yes (wav, mp3, aiff, aac, ogg, flac, webm, mp4, m4a) | no |
| Gemini Interactions (`sessionMode: "stateful"`) | yes | no | no |
| Anthropic Messages | yes | no | yes (10 MB, 2 per request) |

- **In the browser** (`provider: "transformers"`) only Gemma 4 takes media, with one image and one audio clip per request; more is refused, not dropped. Speech-to-text models (Whisper, Moonshine) take audio only. The first use downloads the model and needs WebGPU.
- **On the device** images and audio ride to the native engine inside `genConfig.inputParts`; the on-device model must support the modality, otherwise the call is refused with an error that names it (on iOS it is reported as an invalid request and is never retried on another engine).
- **Preparation.** Images are resized on the device (long edge 1536 px, JPEG; GIF becomes its first frame). Audio sent to an on-device engine is converted to 16 kHz mono WAV and capped per clip (see `useTranscribe` for long recordings); audio sent to Gemini `generateContent` is normalised but not converted.
- **Cost.** Cloud metrics bill audio at the model's audio rate. A model with no confirmed rate reports `audioCostUnknown: true` and a partial cost instead of pricing audio as text.

#### `genConfig`

```
{
  temperature: number,        // 0-1
  maxTokens: number | null,
  topP: number,
  repetitionPenalty: number,  // native/web only
  noRepeatNgramSize: number,  // native/web only
  stream: boolean,
  responseSchema: object,     // anthropic only: a JSON Schema the reply must match
  responseConstraint: object | RegExp, // prompt-api only: constrains Chrome's reply (the reply is then a JSON string)
}
```

`responseSchema` is mapped to the Messages API's `output_config.format` (structured outputs) and is ignored by the other providers. `responseConstraint` is passed to Chrome's built-in model.

`stream: true` uses the SSE path; `stream: false` uses a single-JSON-response path. Cloud and native both expose real `stream`/`generate` HTTP routes for this. The `transformers` provider ignores `genConfig.stream` — the Worker always runs the full generation and streams tokens back internally via `postMessage`.

#### Stateful Sessions

Pass `sessionMode: "stateful"` to carry conversation context across calls. The mechanism is different for each provider, since each has a different notion of "session":

- **Cloud (OpenAI, Gemini)** — the client sends `conversationId` in the request body; the server translates it into the underlying provider's own continuation token (`previous_response_id` for OpenAI, `previous_interaction_id` for Gemini) and returns a fresh `conversationId` with each response.
- **Cloud (Anthropic)** — there is no server-side session. The adapter sends the full history on every turn, ignores `conversationId` and returns `conversationId: null`, so `sessionMode: "stateful"` carries context only because the hook keeps the history.
- **Native** — the client sends `conversationId` to the Ktor route; the Android engine reuses the same LiteRT-LM `Conversation` object when the incoming id matches its current one, otherwise starts a new one. `reset()` also tells the native bridge to drop that object.
- **Web (experimental)** — there is no engine-side session at all. "Stateful" here means the hook accumulates prior `{ role, content }` turns client-side and replays the full history into every `generate()` call — real chat, not KV-cache reuse. `conversationId` is just a locally-generated id for the UI to key off; it carries no meaning beyond the hook instance.

`reset()` clears output, conversation history, and `conversationId` in all three cases. `sessionMode: "stateless"` (the default) makes every `generate()` call independent.

#### Metrics

`metrics` (after a call) and `getSessionMetrics()` (aggregated across the session) differ by provider:

- **Cloud** includes `cost`, `cachedTokens`, `cacheSavings`, `audioCostUnknown` (audio was sent and the model has no confirmed audio rate, so `cost` is partial), and a `byProvider` breakdown, alongside `ttftMs`/`tps`/`totalTokens`.
- **Native** and **web** have no billing, so their metrics are the leaner `{ device, ttftMs, tps, totalTokens, genMs }` (web additionally reports `dtype`, `loadMs`, and `downloadBytes` for the model download, and `cloudEquivalent`: `{ model, cost, estimated: true }`, what the same token counts would have cost at a reference cloud model's text rates, or `null` when the counts are unknown).

Call `resetSessionMetrics()` to clear accumulated history without ending the current conversation.

#### Attachment Components

Pass `attachmentComponents` to have the model return structured, renderable output instead of plain text:

```javascript
useAI({
  attachmentComponents: {
    InfoCard: { attrs: { title: "string", type: "info|warning|success" }, hint: "1 sentence callout" },
  },
});
```

The model is instructed (via an injected system prompt) to wrap relevant output in `{% ComponentName attr='val' %}body{% /ComponentName %}` tags. `output` contains the raw tagged text — render it with `renderOutput(output, streaming)` from `utils/ai.js`, or the `AttachmentRenderer` component. Each key must correspond to a registered React component.

#### Requirements

Requires `catalyst-ai` to be installed (`npm install catalyst-ai`). Without it, `useAI` logs one console error and returns a hook whose `error` is the registry error [`AI-010`](https://github.com/tata1mg/catalyst-core/blob/main/errors/AI/AI-010.md) ("useAI requires catalyst-ai, which is not installed. Run: npm install catalyst-ai"); `generate()` resolves with `{ output: "", error }` using that same error. `cancel`/`reset` are no-ops. The AI hooks built on `useAI` (`useVision`, `useTranscribe`, `useAgent`) report the same error through their own `error`. See [AI Hooks](/content/Catalyst%20AI/choosing-a-hook).

`useAI`'s return shape is owned by the `catalyst-ai` package and sits outside the native hook contract described on this page. It does not follow the single-action or multi-action categories, and the alias and error-shape rules above do not apply to it.

#### `generate()` resolves with the result

`generate(args)` returns a promise that settles when the call has finished, with `{ output, error }`: the final text, or the error that ended it (both empty when the call was cancelled). The hook state (`output`, `loading`, `error`) updates as before, so code that ignores the return value keeps working. With `provider: "auto"` the result also carries `route`, the routing decision for that call.

```js
const { generate } = useAI({ provider: "auto" });
const { output, error, route } = await generate({ messages });
```

#### Native model downloads on a weak or lost connection (`provider: "native"`, or `"auto"` inside an app)

The first on-device use downloads a model (about 2.6 GB for the default Gemma 4 E2B, about 0.6 GB for Qwen3 0.6B). That download no longer starts over when the connection drops or the device goes offline:

- **The partial file is kept** (with the server's ETag) and the next attempt asks only for the rest (`Range` + `If-Range`). If the file changed upstream, the partial is replaced, never spliced: the response's `ETag` is checked against the stored one on every resumed response, because some hosts (Hugging Face's CDN among them) ignore `If-Range` and answer `206` regardless.
- **`useAI` follows `useNetworkStatus`.** When the device goes offline the download pauses; when it is back, it resumes. This works alongside your own `useNetworkStatus()` calls: they share one native subscription.
- **A weak link pauses too.** If the speed stays under a minimum for a sustained window, the download stops, waits and tries again (the wait doubles up to a cap). A connection that resets or times out is retried the same way. It gives up only after several attempts in a row that moved no bytes; the partial stays on disk for the next launch.
- **A safety net** retries on a timer even if the page never hears that the network returned (for example while the WebView was suspended).

The hook result tells you what is happening: `downloadPaused` is `true` while it waits and `downloadPauseReason` is `"offline"`, `"weak"` or `"error"`. `nativeDownloadProgress.phase` is `"paused"` during the wait and `"download"` again once it resumes (the full list of phases is in the Returns table).

Tune it in `config/config.json` (`AI_CONFIG.browser.download`); every key is optional and out-of-range values are clamped. The same object tunes the in-browser download below. Seconds are in seconds, speeds in bytes per second:

```json
"AI_CONFIG": {
  "browser": {
    "download": { "minBytesPerSec": 50000, "windowSec": 20, "resumeDelaySec": 10, "maxIdleRetries": 8, "heldRetrySec": 30 }
  }
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `minBytesPerSec` | `50000` | Below this speed, sustained for `windowSec`, the link counts as weak |
| `windowSec` | `20` | How long the speed is averaged (5-300). Also the idle timeout: no bytes for this long fails the attempt |
| `resumeDelaySec` | `10` | First wait before retrying; doubles each time without progress, up to 120 s |
| `maxIdleRetries` | `8` | Retries, after the first attempt, that may move no bytes in a row before the download gives up. The partial file is kept, so `8` means 9 attempts in all |
| `heldRetrySec` | `30` | While the page reports offline, retry on this interval anyway (5-600), in case the page never hears the network return |

Apps built before this feature do not understand the pause and resume messages, and their download error paths deleted the partial file, so an interrupted download there may start again from zero on the next attempt. Rebuild the app to get resumable downloads.

#### In-browser model downloads (`provider: "transformers"` or `"auto"` in a browser)

The first use of an in-browser model downloads hundreds of megabytes to several gigabytes. That download now survives a bad connection:

- **It does not fail when the connection drops.** The worker's download pauses, waits, and asks only for the rest of the file (`Range: bytes=N-`), then carries on. Transformers.js never sees the interruption.
- **`useAI` follows `useNetworkStatus`.** Offline pauses the download; back online resumes it at once. A connection that resets, times out, or stays below `minBytesPerSec` for `windowSec` is retried with growing backoff, and the download gives up only after several attempts in a row that moved no bytes.
- **A page reload resumes too.** Partial files are kept in the browser's origin-private storage (OPFS), so closing the tab or reloading picks up from the same byte instead of starting again. Storage is freed when a file completes.
- **A file that changes upstream is never spliced.** The response's `ETag` is checked on every resume (Hugging Face's CDN ignores `If-Range`); a different or missing one restarts that file, and if it changes during a single uninterrupted download the load fails with a clear error.
- **Only large files are persisted** (8 MB and up, with a strong ETag and byte-range support). Small files and servers without ranges use the normal fetch. Where OPFS is unavailable the download is simply not resumable.

`downloadPaused` and `downloadPauseReason` (`"offline"`, `"weak"`, `"error"`) on the hook result tell you when a file is waiting. The same `AI_CONFIG.browser.download` settings as the native download apply (`minBytesPerSec`, `windowSec`, `resumeDelaySec`, `maxIdleRetries`).

Inside a native WebView build, the on-device model is the native one: the native module downloads and runs it, and the web engine is not used there.

### `useVision`

Read an image into typed data. Give it a schema, hand it a photo, and get back an object that has been checked against that schema.

```js
import { useVision } from "catalyst-core/hooks";

const schema = {
  type: "object",
  required: ["title", "results"],
  properties: {
    title: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "value", "unit"],
        properties: { name: { type: "string" }, value: { type: "number" }, unit: { type: "string" } },
      },
    },
  },
};

const { scan, data, status, route, error } = useVision({
  schema,
  instructions: "Read this lab report.",
});

await scan(photo); // a captured photo, a File or Blob, or a data:, blob: or https URL
```

`useVision`, its result type and `VisionError` are defined and exported by `catalyst-core/hooks` (they are not part of `catalyst-ai`); only the model call goes through `useAI`.

`useVision` does not open the camera itself. Capture with `useCamera` (or a file input) and pass the result to `scan`, so it works the same on web and native and never competes with another hook for the native camera callback.

| Option | Description |
|--------|-------------|
| `schema` | The shape of the answer: a JSON-Schema subset (`type`, `properties`, `required`, `items`, `enum`, `nullable`) |
| `instructions` | What to read from the image |
| `maxAttempts` | Tries per scan (default `2`, at least `1`). After an unusable reply the model is told what was wrong and asked again, until `maxAttempts` is used up |
| `provider` and other `useAI` options | `provider` defaults to `"auto"` (see Auto routing above). `routing` overrides the policy for this hook |

| Result | Description |
|--------|-------------|
| `scan(source)` | Resolves with the validated data, or `null` when the scan did not complete (read `status`) |
| `approve(consent)` | After `status: "needs-consent"`, allow what the router asked for (`{ cloud: true }` or `{ download: true }`) and run the same scan again |
| `data`, `raw` | The validated result, and the model's last raw reply |
| `status` | `"idle"`, `"running"`, `"done"`, `"error"`, `"needs-consent"` or `"denied"` |
| `route` | Which model was picked and why, or why nothing ran |
| `error`, `attempts`, `partial`, `clear()` | Last error (`VisionError` with `code` and `problems` for an unusable answer), tries used, text arriving while running, reset |

Under auto routing, **a photo never reaches a cloud model unless `policy.cloudMedia` allows it** (the default is `deny`). If only a cloud model could serve the call, the status depends on the policy: with `cloudMedia: "deny"` the scan ends `denied` (nothing is held for approval), and with `cloudMedia: "ask"` it stops at `needs-consent` and nothing is sent until your code calls `approve({ cloud: true })`. When no model can run, the status is `denied` and `route.skipped` lists why each candidate was ruled out.

Small on-device models sometimes answer with prose or a wrong field. The reply is parsed leniently (bare JSON, a fenced block, or the first JSON value inside prose) and validated; an unusable reply is retried with the specific problems, up to `maxAttempts` tries in all, and when the last one is also unusable it is reported as a `VisionError` with code `VISION_INVALID_OUTPUT`, `problems`, and the raw reply in `raw`.

### `useAgent`

A runtime agent: the model picks a tool from the list you give it, your code runs the tool, the result goes back to the model, and this repeats until the model answers or a limit stops it. Steps stream into `steps` while it runs. Built on `useAI` with `provider: "auto"`, so nothing leaves the device unless your routing policy allows it.

```jsx
import { useAgent } from "catalyst-core/hooks"

const agent = useAgent({
    instructions: "You help the user file a lab report.",
    limits: { maxSteps: 6, maxSpendUsd: 0.05 },
    tools: [
        { name: "scan_report", description: "Read the lab report on screen", run: () => scan() },
        { name: "fill_form", description: "Fill the form fields", parameters: { type: "object", required: ["values"], properties: { values: { type: "object" } } }, run: ({ values }) => setForm(values) },
        { name: "submit_form", description: "Submit the form", sideEffect: true, run: () => submit() },
    ],
})

await agent.run("Scan this report and fill in the form")
// agent.pendingConfirmation → { tool: "submit_form", ... }: show a button, then agent.approve() or agent.deny()
```

| Option | Description |
|--------|-------------|
| `tools` | `{ name, description, parameters?, sideEffect?, run(args, { signal }) }`. `parameters` is a JSON Schema subset (the same one `useVision` uses) and every call is checked against it before `run` |
| `instructions` | Who the agent is and what it may do; the tool protocol is added after it |
| `limits` | `maxSteps` (model turns, default 8), `maxSpendUsd` (a soft, estimated budget, off by default; see below), `maxInvalid` (unusable replies in a row that are corrected before the run stops, default 2), `maxResultChars` (the tool result shown to the model is cut to this, default 4000; `steps[].result` keeps the full value) |
| everything else | passed to `useAI` (`model`, `routing`, ...) |

| Result | Description |
|--------|-------------|
| `run(goal, consent?)` | Resolves with `{ status, output, steps, spentUsd }` when the agent stops. `consent` is `{ cloud, download }`, as for `useAI` |
| `status` | `idle`, `running`, `awaiting-confirmation`, then how it ended: `done`, `max-steps`, `max-spend`, `needs-consent`, `denied`, `cancelled` or `error` |
| `steps` | `{ type: "tool", tool, args, outcome: "ok" \| "error" \| "declined", result }`, `{ type: "invalid", problems }` or `{ type: "final", output }` |
| `pendingConfirmation`, `approve()`, `deny()` | A tool marked `sideEffect` waits here for a yes |
| `cancel()`, `output`, `error`, `spentUsd`, `route` | |

What is enforced in code, not left to the prompt:

- **Caps.** Turns stop the run. `maxSpendUsd` is a soft budget checked between model turns: the figure sums the router's per-call cost estimates (so it is only as good as your prices, see `npx catalyst-ai pricing`), and a turn's estimate is added after its call, so the last call can take `spentUsd` past the limit.
- **Side effects need a yes.** A `sideEffect` tool never runs without `approve()`. With no answer (cancel, unmount, error in your UI) it does not run.
- **Tool results are labelled data, and fenced.** What the model sees is clipped to `maxResultChars` (the original return value stays in `steps[].result`, so streamed state can be larger) and wrapped in a fence whose boundary is random per result, so a result cannot close the fence and continue as instructions. Whether the model then ignores directive text inside the result is the model's behaviour, not something code can guarantee: that is why a `sideEffect` tool still needs `approve()`. In code, only the model's own reply can pick the next tool, and an unknown tool or arguments that fail the schema never reach `run`.
- **`cancel()` is cooperative.** A tool being run receives an `AbortSignal`; a tool that ignores it keeps going and `run()` settles only once it returns. A cancel while waiting for an approval declines that tool, and a cancelled run never starts an approved tool.
- **Small models.** Tool use is a JSON protocol with corrective retries (`maxInvalid`, default 2: the run stops when more than that many unusable replies come in a row) rather than a provider feature, because on-device models do not call native tools reliably. Expect more `invalid` steps with small models.

### `usePipeline`

A typed multi-stage pipeline, for example **audio → text → JSON (checked against a schema) → image**, with plain code steps allowed in between. Each stage declares the type it takes and the type it returns; the rules below are enforced in code. `runPipeline(stages, input, options)` is the same engine without React.

```jsx
import { usePipeline, transcribeStage, jsonStage, imageStage } from "catalyst-core/hooks"
import { requestImage, imageCost } from "catalyst-ai"

const stages = [   // keep this stable: module level or useMemo
    transcribeStage((audio) => voice.transcribe(audio).then((r) => r?.text ?? "")),
    // `cloud: true` on every stage that may send the transcript away; a stage without it is not held back by cloudPolicy
    jsonStage({ schema, cloud: true, generate: (prompt) => ai.generate({ messages: [{ role: "user", content: prompt }] }) }),
    imageStage({ requestImage, prompt: (json) => json.scene, cost: (r) => r.usage && imageCost(r.usage).cost }),
]
// For data that came from a recording the default is "deny"; "ask" makes the run stop with needs-consent instead.
const pipeline = usePipeline(stages, { maxCostUsd: 0.1, cloudPolicy: "ask" })

const [held, setHeld] = useState(null)
const start = async () => {
    const result = await pipeline.run(recording)
    // Read the returned result: `pipeline.status` is the value from the render before this run, so it is stale right after the await.
    if (result.status === "needs-consent") setHeld(recording)
}
// Only the person's tap runs it again, with the cloud allowed:
const approve = () => pipeline.run(held, { cloudPolicy: "allow" })
```

| Option | Description |
|--------|-------------|
| `maxCostUsd` | Stop **before the next stage** once the cost reported so far reaches this (USD). Off by default. Stages report cost with `ctx.addCost(usd)`; the figure is only as good as what they report |
| `cloudPolicy` | `"allow"`, `"ask"` or `"deny"` for a stage marked `cloud: true`. Default `"deny"` when the data came from audio (a transcript of a person speaking), `"allow"` for data that did not. An explicit value applies to every cloud stage. `run(input, overrides)` takes the same options for one run |

| Result | Description |
|--------|-------------|
| `run(input, overrides?)` | Resolves with `{ status, output, steps, spentUsd, ... }` when the run stops |
| `status` | `idle`, `running`, then how it ended: `done`, `cancelled`, `error`, `max-spend`, `needs-consent` (a cloud stage was held by `"ask"`), or `denied` (held by `"deny"`) |
| `steps` | Events that grow while it runs: `start` (`index`, `stage`, input type, `cloud`, a short `preview`), `end` (`durationMs`, `costUsd`, `preview`), `error`, and `blocked` (`reason`: `needs-consent`, `denied` or `max-spend`, emitted instead of `start` when execution stopped before a stage began) |
| `output`, `error`, `spentUsd` | The last stage's output when `done`, the error that ended it, and the cost reported so far |
| `cancel()` | Aborts the run. See below: this is cooperative |

Stage factories: `transcribeStage(fn)` (audio → text), `jsonStage({ schema, generate })` (text → json; extracts and validates the JSON and retries once with the problems), `imageStage({ requestImage, prompt })` (json → image; marked `cloud`), `speechStage(fn)` (text → audio-out) and `codeStage(name, inputType, outputType, fn)` for your own steps. Types are `audio`, `text`, `json`, `image` and `audio-out`.

What is enforced in code:

- **The chain is checked up front.** A stage's output type must equal the next stage's input type. A malformed pipeline **throws** (naming both stages) when it is built or run; it does not come back as a status.
- **Every value is checked against its declared type** as it flows, so a stage that returns the wrong shape stops the run at that stage with status `error`.
- **A spend cap and a consent policy stop the run before a stage begins**, never part-way through one.
- **Cancellation is cooperative.** `cancel()` makes the run settle as `cancelled` and no later stage starts, but a stage that has already started keeps going unless it watches `ctx.signal`. Do not read `cancelled` as proof that provider work has stopped. A cancel issued from a `start` listener stops the stage before it begins.
- `preview` on a step is metadata (type and size), never the raw media, so signed URLs and tokens do not end up in logs.

### `useTranscribe`

Speech to text, from a recording or from the microphone. `transcribe(source)` takes a recording (a data URL or a Blob); `listen()` takes the microphone itself. `provider` defaults to `"auto"`, so the router (see `AI_CONFIG.routing`) picks the engine and decides what may leave the device.

```jsx
import { useTranscribe } from "catalyst-core/hooks"

const voice = useTranscribe({ language: "en-US", routing: { cloud: "deny", cloudMedia: "ask" } })

const heard = await voice.listen()      // { text, engine, durationSec, ... } or null when it did not finish
// With cloudMedia "ask" and no on-device engine, listen() resolves null and voice.status becomes "needs-consent" on the next render:
// show a button there that calls voice.approve({ cloud: true }). With "deny" the status is "denied" and nothing can be approved.
```

| Option | Description |
|--------|-------------|
| `language` | BCP 47 tag for the phone's recogniser in `listen()`. Default `"en-US"` |
| `chunkSeconds`, `maxSeconds`, `skipSilence`, `unloadWhenDone` | How a long recording is cut up, the longest accepted (default 120 s), whether silent pieces are skipped, and whether the on-device model is freed afterwards |
| `instructions` | What to ask the model. Speech-to-text models ignore it |
| `routing` | Per-call routing override, including `platformSpeech` (below). Everything else goes to `useAI` |

| Result | Description |
|--------|-------------|
| `listen(consent?)` | Listens until the speaker pauses or `stopListening()` is called. Resolves with `{ text, engine, ... }`, or `null` when it did not complete (read `status`) |
| `transcribe(source)` | Same result shape, for a recording |
| `status` | `idle`, `listening`, `running`, `needs-consent`, `denied`, `error`, `done` |
| `engine` | `"platform-speech"` (the phone's own recogniser) or `"recorder"` (a recording sent to the routed model) |
| `partial`, `text`, `level` | Text so far (the phone's recogniser streams it), the transcript, and loudness while recording (0 for the phone's recogniser) |
| `platformSpeech` | `null` until the shell answers, `false` in a browser, `true` when the phone's recogniser can be used |
| `approve(consent)`, `stopListening()`, `cancel()`, `clear()` | Allow what the router asked for, end the session (the final text still arrives), stop and forget |
| `error`, `route`, `progress`, `model` | The latest error, why the router chose what it did, chunk progress and on-device model state |

Where the voice goes:

- **Inside the iOS and Android apps** the router puts the phone's own recogniser first. It runs on the device, streams partial text and loads no model. If it cannot start, the call is decided again without it, so voice only goes where your routing policy allows.
- **Opt out** with `routing: { platformSpeech: false }` in `AI_CONFIG` or for one call. The opt-out wins over everything, including a `platform-speech` entry you listed yourself.
- **In a browser** the phone's recogniser does not exist, so `listen()` records and sends the clip to the routed model.
- **Consent.** Audio goes to a cloud provider only when the policy allows it (`cloudMedia`) and, if the policy says `ask`, after `approve()`.

### `useMicrophone`

Click-to-talk recording for web pages: `MediaRecorder` makes the clip, a level meter shows how loud it is, and the recording stops by itself after `silenceMs` of quiet once speech was heard, or at `maxSeconds`. The clip is handed over as a data URL (what `useAI` and `useTranscribe` take) and stays on the page.

```jsx
const mic = useMicrophone({ onRecorded: (dataUrl, { seconds }) => send(dataUrl) })
await mic.start()   // { started: true } or { started: false, error }
```

| Option | Description |
|--------|-------------|
| `onRecorded(dataUrl, { seconds })` | Called with the finished clip |
| `onError(message)` | Called when a recording fails or ends with no speech |
| `autoStop`, `silenceMs`, `maxSeconds` | Stop on a pause (default on, 2000 ms) and the longest recording (default 120 s) |

Result: `start()`, `stop()` (deliver the clip), `cancel()` (drop it), `state`, `listening`, `level`, `seconds`, `error` and `supported` (false where the page cannot record, such as a non-secure page). Inside the apps the shell asks for the microphone first (`requestMicrophonePermission`), then lets `getUserMedia` through. A `start()` that you cancel, or that outlives its component, releases the microphone instead of recording.

### `useSpeechRecognition`

The phone's own speech recogniser (Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`), inside the apps only. Recognition is on-device: when a language has no on-device model the shell refuses with `ON_DEVICE_UNAVAILABLE` and nothing is sent to a server. Most apps use `useTranscribe().listen()`, which picks this engine for you; use this hook when you want the session directly.

```jsx
const speech = useSpeechRecognition({ language: "en-IN", onFinal: (text) => setNote(text) })

if (speech.supported) await speech.start()   // { started: true } or { started: false, code }
```

| Option | Description |
|--------|-------------|
| `language` | BCP 47 tag, default `"en-US"` |
| `onPartial(text)`, `onFinal(text)`, `onEnd(text)`, `onError(code)` | Streaming text, the final text, the end of a session (the text is empty when nothing was recognised), and the shell's error code |

| Result | Description |
|--------|-------------|
| `start()` | Asks for the microphone, then starts. Resolves `{ started, code? }`. `code` is `UNSUPPORTED`, `BUSY`, `PERMISSION_DENIED`, `ON_DEVICE_UNAVAILABLE`, `LANGUAGE_UNAVAILABLE`, or `CANCELLED` when you cancelled or unmounted while the permission prompt was open |
| `stop()`, `cancel()` | End the session (the final text still arrives) / end it and drop what was heard |
| `state`, `listening`, `partial`, `text`, `seconds`, `level` | Session state (`level` is always 0: the platform recognisers do not report it) |
| `error`, `errorCode`, `supported`, `support` | The latest error, `supported` (`null` until the shell answers, `false` in a browser or for a language with no on-device model) and the shell's support reply |

Several components may use the hook at once. They share one subscription to the shell, and a session's events go only to the component that started it; a second one starting while one is running gets `BUSY`.

### `requestMicrophonePermission`

Asks the native shell (Android or iOS) for microphone permission so a page can record with `getUserMedia({ audio })`. The hooks above call it for you; call it yourself only when you use `getUserMedia` directly.

```jsx
import { requestMicrophonePermission } from "catalyst-core/hooks"

try {
    await requestMicrophonePermission()       // "GRANTED", or null when there is nothing to ask
} catch {
    // the user refused
}
```

Resolves `"GRANTED"` once the app holds it, rejects when the user refuses, and resolves `null` where there is nothing to ask or nobody answers: a plain browser (it prompts by itself), a page without `WebBridge`, or a shell built before the command existed. Overlapping calls share one request.

Only the app's own page may use the microphone. On Android and iOS the WebView grants capture only to the app's own origin, by exact scheme, host and port; `accessControl.allowedUrls` does not widen this, because its rules match substrings and a lookalike host could pass them. On iOS the microphone bridge commands also run only from the app's own main-frame page.
