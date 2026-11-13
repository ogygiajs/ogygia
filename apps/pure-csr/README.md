# pure-csr

A SvelteKit app where no route sets `csr = false`. With no such page, ogygia builds no runtime at
all. A component here still uses `<Region>` around an interactive component, and the app must still
work: the page renders and Kit hydrates the inner component. ogygia steps aside and Kit owns
hydration.

Internal. Never published or deployed. Its one user is `apps/palaestra/e2e/pure-csr.spec.ts`, which
builds this app, checks the build has no ogygia runtime file, serves it, and checks the page in a
browser.

## Run

```bash
pnpm --filter palaestra e2e pure-csr   # the normal way
pnpm --filter pure-csr build           # by hand (build the libraries first: pnpm build:lib)
pnpm --filter pure-csr check           # svelte-check
```

It has no `dev` script. Keep every route `csr = true`: one `csr = false` page and the test no longer
tests anything.
