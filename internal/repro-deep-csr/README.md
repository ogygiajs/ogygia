# internal/repro-deep-csr

A small SvelteKit app for one bug shape. The root layout says nothing about `csr`. The only
`csr = false` is on a deep catch-all page (`/content/[...slug]`), and one other page (`/spa`) keeps
`csr = true`. The layout's chrome (a header with a counter region, and a headless boot region) must
still render as regions and wake on `/content/*`, and fall back to plain Kit components on `/spa`.

Internal. Never published. Its one user is `apps/palaestra/e2e/deep-csr.spec.ts`, which builds this
app, serves its adapter-node output, and checks both pages in a browser. The rule it guards is in
`internal/notes/INVARIANTS.md` (the PAGE-CSR invariant).

## Run

The normal way is the spec:

```bash
pnpm --filter palaestra e2e deep-csr
```

By hand:

```bash
pnpm --filter repro-deep-csr dev     # port 3071
pnpm --filter repro-deep-csr build   # adapter-node output in build/ (gitignored)
```

It uses the workspace `ogygia`, so build the libraries first (`pnpm build:lib`).
