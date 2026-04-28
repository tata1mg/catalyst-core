---
title: Customising Shell
slug: customising-shell
id: customising-shell
---

# Customising Shell

The document is the HTML template served by the Node server for every page request. Customizing it allows you to modify the `<head>`, `<body>`, and other HTML elements.

Create or edit `server/document.js` to customize:

## Basic Structure

```jsx title="server/document.js"
import React from "react";
import { Head, Body } from "catalyst";

function Document(props) {
  return (
    <html lang="en">
      <Head {...props} />
      <Body {...props} />
    </html>
  );
}

export default Document;
```

## Adding Global Metadata

```jsx title="server/document.js"
import React from "react";
import { Head, Body } from "catalyst";

function Document(props) {
  return (
    <html lang="en">
      <Head {...props}>
        <meta name="description" content="My Catalyst App" />
        <meta name="theme-color" content="#007bff" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Body {...props} />
    </html>
  );
}

export default Document;
```

## Adding Scripts and Styles

```jsx title="server/document.js"
import React from "react";
import { Head, Body } from "catalyst";

function Document(props) {
  return (
    <html lang="en">
      <Head {...props}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <script src="https://analytics.example.com/script.js" async />
      </Head>
      <Body {...props}>
        {/* Content injected after the app */}
        <script
          dangerouslySetInnerHTML={{
            __html: `console.log('App loaded');`,
          }}
        />
      </Body>
    </html>
  );
}

export default Document;
```

## Accessing Request Data

The `props` object includes the request, allowing server-side customization:

```jsx title="server/document.js"
import React from "react";
import { Head, Body } from "catalyst";

function Document(props) {
  const { req } = props;
  const lang = req.headers["accept-language"]?.split(",")[0] || "en";

  return (
    <html lang={lang}>
      <Head {...props} />
      <Body {...props} />
    </html>
  );
}

export default Document;
```

## Props Reference

| Prop | Description |
|------|-------------|
| `req` | Express request object |
| `res` | Express response object |
| `scripts` | Array of script tags for the page |
| `styles` | Array of style tags for the page |
| `initialState` | Serialized Redux state (if using Redux) |
