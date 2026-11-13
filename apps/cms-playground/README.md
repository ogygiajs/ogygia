# cms-playground

A small site whose pages come from a headless CMS instead of markdown files. The "CMS" is fake: an
in-memory database (`src/lib/server/db.ts`) behind REST routes under `/api`. The site's
`@ogygia/content` loader (`src/lib/cms.ts`) reads those routes over HTTP, the way it would read a
real CMS. Page bodies are block trees, rendered through a block registry (`src/lib/blocks/`). Each
block renders on the server, and one (`Counter`) is a region that wakes when it scrolls into view.

Internal. Never published or deployed. CI only runs its svelte-check (through `pnpm check`); no
e2e test covers it. Use it to try the content API against remote data.

## Run

```bash
pnpm build:lib                          # it uses the workspace ogygia and @ogygia/content
pnpm --filter cms-playground dev        # http://localhost:5281
pnpm --filter cms-playground check      # svelte-check
```

The dev server must be on port 5281 (the script uses `--strictPort`). The loader fetches the CMS
from `http://localhost:5281/api`, which is this same server. Draft pages open with
`?preview=secret`.
