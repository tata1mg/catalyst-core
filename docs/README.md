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

### Release pages

`/releases` lists the release announcements and `/releases/<version>` shows
one, with its release film above that version's section of
`packages/catalyst-core/changelog.md`. The full changelog stays at
`/content/changelog` (`/content/releases` 301s there).

To announce a release:

1. Make sure the changelog has a `## [x.y.z] - date` section. The generator
   fails if `release-pages.json` lists a version the changelog does not.
2. Upload the film to the GitHub release:
   `gh release upload catalyst-core@x.y.z catalyst-core-x.y.z.mp4`. Use the
   1080p share render (H.264, faststart) and keep it under about 15 MB.
3. Save a poster frame as `static/img/releases/x.y.z.jpg` (1280px wide).
4. Add the entry at the top of `release-pages.json` (newest first) with the
   headline, a one-sentence summary, the tag, the video URL and the poster.

The poster also becomes the page's social card image.

For a fuller announcement, add `release-stories/x.y.z.mdx`. The page then
shows a centred headline, the film with the two `notes` from
`release-pages.json` beside it, and the story, with the changelog section
folded into "Full release notes" below. The story uses the components in
`src/js/containers/Releases/storyComponents.js` (`Section`, `Snippets`,
`Feature`, `Farewell`, `Fixes`, `Tip`, `Thanks`); `1.0.2.mdx` is the
reference. Card images live in `static/img/releases/x.y.z/`.

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

## Versioning

`versions.json` lists the majors the site serves. Latest is built from
`content/` at the current URLs. Every other entry is built from `content/` as it
was at a git ref and served under `/v/<major>/`, with a canonical link and
`noindex` pointing readers and search engines at latest.

When a new major ships, before its release PR merges:

1. Freeze the outgoing docs: `git tag catalyst-docs-1.x origin/main && git push origin catalyst-docs-1.x`.
2. In `versions.json`, give the outgoing entry `"ref": "catalyst-docs-1.x"` and drop its
   `latest`; add the new major as `{ "label": "2.x", "major": 2, "ref": "HEAD", "latest": true }`.
3. Add `node docs/scripts/generate-docs-manifest.mjs --export` to the Devtron pre-build
   script, before `docker build`. The image has no `.git`, so the export cannot run inside
   it. A missing export fails the build rather than shipping a site without that version.

Nothing else is needed. The export lands in `versions/` (gitignored), `COPY docs ./docs`
ships it, and the normal build picks it up.
