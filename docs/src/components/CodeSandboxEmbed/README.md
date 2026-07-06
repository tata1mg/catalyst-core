# CodeSandbox Embed Component

A reusable React component for embedding CodeSandbox projects in markdown files with a clean, modern interface.

## Usage

```jsx
import CodeSandboxEmbed from '@site/src/components/CodeSandboxEmbed'
;<CodeSandboxEmbed
    url="https://codesandbox.io/p/github/mayankmahavar1mg/build-test/main"
    file="/src/js/routes/index.js"
    title="Dynamic Routing"
    description="Breed detail pages with URL parameters"
/>
```

## Props

| Prop             | Type                | Default                      | Description                                  |
| ---------------- | ------------------- | ---------------------------- | -------------------------------------------- |
| `url`            | string              | **required**                 | CodeSandbox project URL                      |
| `file`           | string              | `''`                         | Specific file to highlight in the embed      |
| `title`          | string              | `'Live Example'`             | Component title                              |
| `description`    | string              | `'Interactive code example'` | Component description                        |
| `theme`          | `'light' \| 'dark'` | `'dark'`                     | Embed theme                                  |
| `height`         | string              | `'400px'`                    | Custom height for the embed                  |
| `width`          | string              | `'100%'`                     | Custom width for the embed                   |
| `responsive`     | boolean             | `true`                       | Make component responsive                    |
| `className`      | string              | `undefined`                  | Additional CSS class                         |
| `hideSidebar`    | boolean             | `true`                       | Hide CodeSandbox sidebar                     |
| `hideTerminal`   | boolean             | `true`                       | Hide CodeSandbox terminal                    |
| `hideNavigation` | boolean             | `false`                      | Hide navigation (redundant with hideSidebar) |
| `hidePreview`    | boolean             | `true`                       | Hide preview, show editor only               |

## Examples

### Basic Usage

```jsx
<CodeSandboxEmbed url="https://codesandbox.io/p/github/mayankmahavar1mg/build-test/main" />
```

### With File Highlighting

```jsx
<CodeSandboxEmbed
    url="https://codesandbox.io/p/github/mayankmahavar1mg/build-test/main"
    file="/src/js/pages/Products/Products.js"
    title="Products Store"
    description="Redux store with actions and reducers"
    hideSidebar={true}
    hideTerminal={true}
    hidePreview={true}
/>
```

### Custom Height and Theme

```jsx
<CodeSandboxEmbed
    url="https://codesandbox.io/p/github/mayankmahavar1mg/build-test/main"
    file="/src/js/pages/StylingDemo/StylingDemo.js"
    title="Styling Demo"
    description="CSS Modules, dynamic theming, and animations"
    height="500px"
    theme="dark"
/>
```

## Manual CodeSandbox Configuration

If the automatic parameters don't work as expected, you can manually configure the embed in CodeSandbox:

### Step 1: Open Your CodeSandbox Project

1. Go to your CodeSandbox project
2. Click the **"Share"** button in the top right

### Step 2: Configure Embed Settings

1. Click on the **"Embed"** tab
2. Configure the following settings:
    - **Hide Navigation**: ✅ Check this to hide the sidebar
    - **Hide Dev Tools**: ✅ Check this to hide the terminal
    - **Theme**: Select "Dark" or "Light"
    - **File to Open**: Select the specific file to highlight
    - **View**: Select "Editor" to hide preview

### Step 3: Copy the Embed URL

1. The embed URL will be generated automatically
2. Copy the URL and use it directly in the component:

```jsx
<CodeSandboxEmbed
    url="https://codesandbox.io/p/github/mayankmahavar1mg/build-test/main?embed=1&hidenavigation=1&hidedevtools=1&theme=dark&file=%2Fsrc%2Fjs%2Fcontainers%2FHome%2FHome.js&view=editor"
    title="Data Fetching Demo"
    description="Server-side and client-side data fetching with Catalyst"
/>
```

## CodeSandbox URL Parameters

The component automatically adds these parameters:

| Parameter          | Description                      | Value                        |
| ------------------ | -------------------------------- | ---------------------------- |
| `embed=1`          | Enables embed mode               | Always added                 |
| `hidenavigation=1` | Hides the sidebar/file explorer  | When `hideSidebar=true`      |
| `hidedevtools=1`   | Hides the terminal/console       | When `hideTerminal=true`     |
| `hideconsole=1`    | Additional terminal hiding       | When `hideTerminal=true`     |
| `theme=dark`       | Sets the theme                   | Based on `theme` prop        |
| `view=editor`      | Shows editor only, hides preview | When `hidePreview=true`      |
| `fontsize=14`      | Sets font size                   | Always added                 |
| `file=/path`       | Highlights specific file         | When `file` prop is provided |

## Features

- ✅ **Responsive Design**: Works on all screen sizes
- ✅ **Loading States**: Smooth loading experience with spinner
- ✅ **Error Handling**: Fallback link if embed fails
- ✅ **Accessibility**: Proper ARIA labels and keyboard navigation
- ✅ **Theme Support**: Light and dark theme options
- ✅ **File Highlighting**: Focus on specific files in the project
- ✅ **Custom Styling**: Matches catalyst-docs theme
- ✅ **CodeSandbox Integration**: Automatic parameter configuration
- ✅ **Clean Interface**: No extra buttons, uses CodeSandbox's built-in "Open in Code Editor"

## Troubleshooting

### Terminal Still Shows

If the terminal is still visible, try:

1. Use the manual configuration method above
2. Add `hideconsole=1` parameter manually
3. Check if your CodeSandbox project has specific settings that override embed parameters

### Sidebar Still Shows

If the sidebar is still visible:

1. Ensure `hidenavigation=1` is in the URL
2. Try using the manual embed configuration in CodeSandbox
3. Check if the project has navigation locked

### Preview Still Shows

If the preview is still visible:

1. Ensure `view=editor` is in the URL
2. Use the manual configuration method in CodeSandbox
3. Set "View" to "Editor" in the embed settings

### Embed Not Loading

If the embed fails to load:

1. Check if the URL is correct
2. Ensure the project is public or accessible
3. Try opening the URL directly in a browser
4. Check browser console for errors
