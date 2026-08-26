# Catalyst docs

The documentation site at [catalyst.1mg.com](https://catalyst.1mg.com), built
with Catalyst itself.

## Setup

`config/config.json` is gitignored — it holds per-environment hostnames:

```bash
npm install
cp config/config_template.json config/config.json
```

## Running

```bash
npm start          # dev server
npm run build      # production build
npm run serve      # serve the production build (port 3005)
```

`prestart` and `prebuild` run `docs:generate` for you, so the routes are always
built from the current content.

## How content becomes pages

Everything under `content/` is the source. `scripts/generate-docs-manifest.mjs`
walks it and emits, into the gitignored `src/js/generated/`:

- `docsManifest.json` — title, description, category chain, TOC, prev/next, and
  the text the search modal indexes
- `docsRoutes.jsx` — one route per page
- compiled MDX, one `.mjs` module per page

It also copies images into `public/`, and writes `sitemap.xml` and `robots.txt`.

Nothing in `src/js/generated/` or `public/` is committed. Both are rebuilt on
every run, so edit `content/` and never the output.

### URLs are a contract

The site was Docusaurus until recently, and its URLs are indexed. The generator
reproduces the Docusaurus permalink scheme exactly — numeric `NN-` prefixes
stripped per path segment, spaces and case preserved, frontmatter `slug`/`id`
honored — so a page keeps the address it already had.

`npm run docs:check-links -- --strict` runs in CI and fails the build on a
broken link or asset.

Docusaurus served under a `/public_docs` prefix; this app serves at the root and
301s the old prefix, so existing links keep working. Those redirects live in
`server/server.js`, along with the 410s for pages the old platform had and this
one doesn't.

### Admonitions

`:::note` / `:::tip` / `:::info` / `:::warning` / `:::danger` / `:::caution`
work, with an optional title:

```markdown
:::warning Version scope
This applies to 0.2.x and earlier.
:::
```

Docusaurus's space-separated title is not valid `remark-directive` syntax — it
wants `:::warning[Version scope]`. Rather than rewrite the content, the fence is
normalized before parsing (`scripts/remark-admonitions.mjs`), so either form
works.

## Deployment

`Dockerfile` builds and runs the app; its context is this directory. The image
runs Catalyst's own SSR server on port 3005 — there is no separate Express app
in front of it any more.

The image bakes `config_template.json` as a starting point. **Overwrite or mount
the real `config/config.json` at deploy time.** Leaving the template in place
does not fail the build or the health check — it just makes SSR emit
`localhost:3005` asset URLs, so pages return 200 while loading nothing.
