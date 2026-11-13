# palaestra

The main test app. Core's e2e suite runs against it, and so do the simulator, the bundle-size check
and the server-cost check. Each route is a lab for one feature or one bug: regions on every schedule,
holes, lakes, the router, page data, CSS, Kit pages next to ogygia pages.

Internal. Never published. It lists no ogygia plugin on purpose: a plugin's specs live
with that plugin, against its own fixture app (`packages/<name>/e2e/app`).

## Run

From the repository root:

```bash
pnpm dev                                     # build the libraries, then the palaestra's dev server
pnpm build                                   # build the libraries, then the palaestra
pnpm turbo run e2e --filter=palaestra        # core's e2e suite (libraries built first)
pnpm --filter palaestra e2e split-brain      # one spec (libraries already built)
E2E_NO_BUILD=1 pnpm --filter palaestra e2e   # reuse the last palaestra build
pnpm --filter palaestra check                # svelte-check, then tsc on the specs
```

The suite builds the app and serves that build with `vite preview` on port 3051.
[`e2e/README.md`](./e2e/README.md) has the suite's spec list and how its servers work.

## What else lives here

- `e2e/`: core's specs. Some build other apps of their own: `apps/pure-csr`,
  `internal/repro-deep-csr`, `internal/repro-kit3`. `turbo.json` lists those folders, so a change
  there reruns this suite.
- `dedup-fixture/`: a small standalone build `e2e/dedup.spec.ts` makes, to prove a component
  imported twice lands in one chunk.
- It depends on `internal/repro-hole-css-kit` and `internal/repro-subpkg`, two workspace packages its
  pages import.
- `pnpm sim` runs the simulator on it by default ([`internal/sim`](../../internal/sim)).

A new route here is a new lab. Give it a spec in `e2e/` that says what it proves.
