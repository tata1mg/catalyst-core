---
title: Hooks
slug: hooks
id: hooks
---

# Hooks

Catalyst exposes two groups of hooks:

- routing hooks from `@tata1mg/router`
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
import { useRouterData } from "@tata1mg/router";
```

#### Return Value

Returns an object containing data for all active routes, keyed by route path.

#### Usage

```javascript
import { useRouterData } from "@tata1mg/router";

const Layout = () => {
  const routerData = useRouterData();
  // { "/dashboard": { data, error, ... }, "/dashboard/settings": { data, error, ... } }
};
```

### `useCurrentRouteData`

`useCurrentRouteData` provides access to the data resolved by `serverFetcher` or `clientFetcher` for the current route.

#### Import

```javascript
import { useCurrentRouteData } from "@tata1mg/router";
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
import { useCurrentRouteData } from "@tata1mg/router";

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
} from "catalyst-core/hooks";
```

Most native hooks follow a common pattern:

- `data`
- `loading`
- `error`
- `progress`
- `isWeb`
- `isNative`
- `execute`
- `clear`
- `clearError`

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

```javascript
function PhotoCapture() {
  const { takePhoto, loading, error, data, isNative } = useCamera();

  const handleCapture = async () => {
    const photo = await takePhoto();
    if (photo) {
      console.log("Photo captured:", photo.fileName);
    }
  };

  return (
    <button onClick={handleCapture} disabled={loading || !isNative}>
      Take Photo
    </button>
  );
}
```

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
| `execute` | `(feedbackType?, options?) => Promise<boolean>` | Trigger haptic feedback |
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

### `useAI`

Generate text through one of three providers, chosen with the `provider` option — the hook picks the underlying implementation for you:

| `provider` | Implementation | Where it runs |
|------------|-----------------|----------------|
| `"openai"` \| `"gemini"` (default) | `useCloudAI` | Node server route (`POST /ai/:provider/stream` or `/generate`) |
| `"native"` | `useNativeAI`, falls back to `useCloudAI` if `window.NativeBridge` is unavailable | On-device LiteRT-LM engine, via an embedded Ktor server (`POST /framework-{sessionId}/ai/stream` or `/generate`) |
| `"transformers"` | `useWebAI` — **experimental**: in-browser inference quality and WebGPU/WASM backend selection aren't reliable yet on larger models | In-browser, via a Web Worker running Transformers.js |

Requires `@catalyst/cloud-ai` to be installed in the app.

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

Requires `@catalyst/cloud-ai` to be installed (`npm install @catalyst/cloud-ai`). Without it, `useAI` logs an error and returns an inert hook (all booleans `false`, `generate`/`cancel`/`reset` are no-ops).
