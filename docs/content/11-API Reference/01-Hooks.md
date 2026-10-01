---
title: Hooks
slug: hooks
id: hooks
---

# Hooks

Catalyst exposes two groups of hooks:

- route data hooks (`useRouterData`, `useCurrentRouteData`) from `catalyst-core`
- React Router hooks (`useParams`, `useNavigate`, `useLocation`, and the rest) from `react-router`,
  which Catalyst declares as a peer dependency
- native or universal app hooks from `catalyst-core/hooks`

## Hooks Overview

| Hook / API | Description | Web | iOS | Android |
|------------|-------------|-----|-----|---------|
| `useRouterData` | Access data for all matched routes | Yes | Yes | Yes |
| `useCurrentRouteData` | Access current route fetcher state and data | Yes | Yes | Yes |
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

`Partial` means behavior depends on browser support or fallback behavior in the web environment.

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
| `selectedFiles` | `array` | Selected file entries |
| `loading` | `boolean` | Picker flow in progress |
| `error` | `object \| null` | Standardized error object |
| `execute` | `function` | Open the file picker |
| `pickFile` | `function` | Alias for `execute` |
| `getFileObject` | `function` | Convert one selected result into a browser `File` |
| `getAllFileObjects` | `function` | Convert all selected results into `File[]` |
| `clear` | `function` | Clear picker state |
| `clearError` | `function` | Clear error state only |

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

Open a file or URL with an external native app.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `execute` | `function` | Open the target URL with the provided MIME type |
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

Read safe-area insets in pixels. On web and SSR, all values are `0`.

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

`useAI`'s shape — including its error handling — is owned by the `catalyst-ai` package and is outside this contract.

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
| `"openai"` \| `"gemini"` (default) | `useCloudAI` | Node server route (`POST /ai/:provider/stream` or `/generate`) |
| `"native"` | `useNativeAI`, falls back to `useCloudAI` if `window.NativeBridge` is unavailable | On-device LiteRT-LM engine, via an embedded Ktor server (`POST /framework-{sessionId}/ai/stream` or `/generate`) |
| `"transformers"` | `useWebAI` — **experimental**: in-browser inference quality and WebGPU/WASM backend selection aren't reliable yet on larger models | In-browser, via a Web Worker running Transformers.js |

Requires `catalyst-ai` to be installed in the app.

#### Import

```javascript
import { useAI } from "catalyst-core/hooks";
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `string` | `"openai"`, `"gemini"`, `"native"`, or `"transformers"`. Defaults to the cloud provider configured in `AI_CONFIG.browser`. |
| `model` | `string` | Model id. Required for `transformers`; optional override for cloud/native. |
| `genConfig` | `object` | Default generation config, merged with any per-call `genConfig` passed to `generate()`. See below. |
| `systemPrompt` | `string` | System prompt prepended to every generation. |
| `sessionMode` | `string` | `"stateless"` (default) or `"stateful"` — see Stateful Sessions below. |
| `attachmentComponents` | `object` | Map of component name → `{ attrs, hint }`, enabling structured output. See Attachment Components below. |

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `output` | `string` | Accumulated generation text so far. |
| `streaming` | `boolean` | `true` while SSE tokens are actively arriving. |
| `loading` | `boolean` | `true` while a request is in flight (covers both the stream and non-stream paths). |
| `error` | `Error \| null` | Error from the last `generate()` call, if any. |
| `generate` | `function` | `generate({ messages, genConfig })` — triggers a request. `messages` is `[{ role, content }, ...]`. |
| `cancel` | `function` | Abort the in-flight generation. |
| `reset` | `function` | Clear output, error, and conversation state; ends the current session. |
| `clearError` | `function` | Clear `error` only. |
| `conversationId` | `string \| null` | Present when `sessionMode="stateful"` — see below for what it means per provider. |
| `isLocal` / `isNative` / `isWeb` | `boolean` | Indicates which provider actually served the request. |
| `modelReady` | `boolean` | For `native`/`transformers`: `false` while the model is downloading or the engine is initializing. |
| `downloadProgress` | `object \| null` | For `transformers`: `{ file, percent, status }`. |
| `nativeDownloadProgress` | `object \| null` | For `native`: `{ phase, percent, detail }` (`phase` is `"engine_init"` or `"model_fetch"`). |
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

#### `genConfig`

```
{
  temperature: number,        // 0-1
  maxTokens: number | null,
  topP: number,
  repetitionPenalty: number,  // native/web only
  noRepeatNgramSize: number,  // native/web only
  stream: boolean,
}
```

`stream: true` uses the SSE path; `stream: false` uses a single-JSON-response path. Cloud and native both expose real `stream`/`generate` HTTP routes for this. The `transformers` provider ignores `genConfig.stream` — the Worker always runs the full generation and streams tokens back internally via `postMessage`.

#### Stateful Sessions

Pass `sessionMode: "stateful"` to carry conversation context across calls. The mechanism is different for each provider, since each has a different notion of "session":

- **Cloud** — the client sends `conversationId` in the request body; the server translates it into the underlying provider's own continuation token (`previous_response_id` for OpenAI, `previous_interaction_id` for Gemini) and returns a fresh `conversationId` with each response.
- **Native** — the client sends `conversationId` to the Ktor route; the Android engine reuses the same LiteRT-LM `Conversation` object when the incoming id matches its current one, otherwise starts a new one. `reset()` also tells the native bridge to drop that object.
- **Web (experimental)** — there is no engine-side session at all. "Stateful" here means the hook accumulates prior `{ role, content }` turns client-side and replays the full history into every `generate()` call — real chat, not KV-cache reuse. `conversationId` is just a locally-generated id for the UI to key off; it carries no meaning beyond the hook instance.

`reset()` clears output, conversation history, and `conversationId` in all three cases. `sessionMode: "stateless"` (the default) makes every `generate()` call independent.

#### Metrics

`metrics` (after a call) and `getSessionMetrics()` (aggregated across the session) differ by provider:

- **Cloud** includes `cost`, `cachedTokens`, `cacheSavings`, and a `byProvider` breakdown, alongside `ttftMs`/`tps`/`totalTokens`.
- **Native** and **web** have no billing, so their metrics are the leaner `{ device, ttftMs, tps, totalTokens, genMs }` (web additionally reports `dtype`, `loadMs`, and `downloadBytes` for the model download).

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

Requires `catalyst-ai` to be installed (`npm install catalyst-ai`). Without it, `useAI` logs an error and returns an inert hook (all booleans `false`, `generate`/`cancel`/`reset` are no-ops).

`useAI`'s return shape is owned by the `catalyst-ai` package and sits outside the native hook contract described on this page. It does not follow the single-action or multi-action categories, and the alias and error-shape rules above do not apply to it.
