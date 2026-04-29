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

| Hook | Description | Web | iOS | Android |
|------|-------------|-----|-----|---------|
| `useRouterData` | Access data for all matched routes | Yes | Yes | Yes |
| `useCurrentRouteData` | Access current route fetcher state and data | Yes | Yes | Yes |
| `useCamera` | Capture media via the bridge or web fallback | Partial | Yes | Yes |
| `useFilePicker` | Select files and normalize results | Partial | Yes | Yes |
| `useHapticFeedback` | Trigger haptic feedback with platform-aware behavior | No | Yes | Yes |
| `useStorage` | Persist key-value data across platforms | Yes | Yes | Yes |
| `useDeviceInfo` | Read platform and device details | Partial | Yes | Yes |
| `useNotification` | Schedule local notifications and manage push setup | No | Yes | Yes |

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
  useHapticFeedback,
  useStorage,
  useDeviceInfo,
  useNotification,
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

### `useStorage`

Cross-platform key-value storage for universal apps.

#### Returns

| Method | Type | Description |
|--------|------|-------------|
| `getItem` | `(key) => Promise<string>` | Get value by key |
| `setItem` | `(key, value) => Promise<void>` | Store value |
| `removeItem` | `(key) => Promise<void>` | Delete value |
| `clear` | `() => Promise<void>` | Clear all storage |
| `getAllKeys` | `() => Promise<string[]>` | List all keys |

#### Usage

```javascript
function UserPreferences() {
  const { getItem, setItem, removeItem } = useStorage();

  const saveTheme = async (theme) => {
    await setItem("theme", theme);
  };

  return <button onClick={() => saveTheme("dark")}>Set Dark Theme</button>;
}
```

### `useDeviceInfo`

Read platform and device information in a normalized format.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `platform` | `"web" \| "ios" \| "android"` | Current platform |
| `model` | `string` | Device model name |
| `manufacturer` | `string` | Device manufacturer |
| `screenWidth` | `number` | Screen width in pixels |
| `screenHeight` | `number` | Screen height in pixels |
| `screenDensity` | `number` | Screen pixel density |

#### Usage

```javascript
function DeviceDetails() {
  const { platform, model, manufacturer, screenWidth, screenHeight, screenDensity } = useDeviceInfo();

  return (
    <div>
      <p>Platform: {platform}</p>
      <p>Model: {model}</p>
      <p>Manufacturer: {manufacturer}</p>
      <p>Screen: {screenWidth} x {screenHeight} ({screenDensity}x)</p>
    </div>
  );
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
