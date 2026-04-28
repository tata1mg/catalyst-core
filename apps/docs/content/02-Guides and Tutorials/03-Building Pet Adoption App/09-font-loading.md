---
title: Font Loading
slug: font-loading
id: font-loading
sidebar_position: 9
---

# Font Loading

Add custom fonts to improve the application's typography.

---

## Add Google Fonts

Update `server/document.js` to preload fonts:

```jsx title="server/document.js"
import React from "react";
import { Head, Body } from "catalyst-core";

function Document(props) {
  return (
    <html lang="en">
      <Head {...props}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Body {...props} />
    </html>
  );
}

export default Document;
```

---

## Apply the Font

Update your CSS to use the font:

```css title="src/static/css/base/pet-styles.css"
body {
  font-family: "Poppins", Arial, sans-serif;
}
```

The Poppins font now applies to all text. Next, we'll add code splitting.