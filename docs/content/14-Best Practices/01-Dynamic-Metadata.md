---
title: SEO
slug: seo
id: seo
---

# SEO

Catalyst renders pages through SSR, so metadata should be treated as part of the route contract rather than an afterthought. Good SEO in Catalyst starts with returning the right metadata for the right route on the server.

## Core Practice

Define metadata on the route component with `setMetaData` so search engines receive the correct tags in the initial HTML.

```jsx title="src/js/containers/Home/Home.js"
function HomePage() {
  return <div>Homepage</div>;
}

HomePage.setMetaData = (apiResponse) => {
  return [
    <title key="title">{apiResponse?.title || "Home"}</title>,
    <meta
      key="description"
      name="description"
      content={apiResponse?.description || "Default description"}
    />,
  ];
};

export default HomePage;
```

## What to Set Per Route

- a unique `<title>`
- a meaningful meta description
- a canonical URL for pages that can appear through multiple entry paths
- Open Graph and Twitter tags for shareable pages

## Production Guidance

- Generate metadata from the same server data used to render the page so content and metadata do not drift.
- Keep canonical URLs stable across pagination, filters, and campaign params.
- Avoid generic titles such as `Home` or `Product` on content-rich routes.
- Ensure the SSR output contains useful above-the-fold text, not just a shell and client-side placeholders.
- Use one clear primary title per page and keep the metadata focused on user intent.

## Common Mistakes

- setting metadata only after hydration
- reusing the same title and description across many routes
- generating canonicals from unstable query params
- omitting social tags on pages that are frequently shared externally

## Related Docs

- [SSR Lifecycle](/content/11-API%20Reference/04-SSR-Lifecycle.md)
- [Data Fetching](/content/data-fetching)
