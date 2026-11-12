# docs

The ogygia docs site, [ogygiajs.dev](https://ogygiajs.dev). It is built with ogygia itself, so it is
also a real app we test on: its pages are `csr = false` with regions, and its content comes through
`@ogygia/content`.

Internal. Never published. The live site deploys from the `latest` branch (what npm has), so it
matches the released packages. `vercel.json` says which other branches deploy, and holds the
redirects for moved pages.

## Where things are

- `src/content/docs/`: the pages. One folder per section, one folder per page
  (`NN-section/NN-page/+doc.svx`), with the page's demo components beside it. The `NN-` prefixes set
  the order and are dropped from the URL. Each package other than `ogygia` has its own top-level
  folder (`11-router`, `13-devtools`, …).
- API pages are generated from each package's built `.d.ts` (`src/lib/api-ref/`). Build the
  libraries before you expect them to change.
- `src/routes/playground/` and `src/content/playground/`: a sample site built on
  `@ogygia/content`'s docs shell and themes, prerendered whole.
- `static/tests/<version>/`: the tests page's data, written by `.github/scripts/test-report.ts` at
  release. Do not edit it by hand.
- `src/lib/fonts/`: subset font files, committed. `pnpm --filter docs fonts` rebuilds them after a
  font package bump. The site build never runs it.

## Run

From the repository root:

```bash
pnpm dev:docs                        # build the libraries, then the dev server on port 5174
pnpm build:docs                      # build the libraries, then the site
pnpm --filter docs check             # svelte-check, tsc on the specs, the releases tests
pnpm --filter docs check:links       # after a build: every internal link and #anchor resolves
pnpm turbo run e2e --filter=docs     # e2e: dev HMR under csr=false, search, sidebar, releases
```

When you change a user-facing behaviour, change the page that describes it in the same PR.
