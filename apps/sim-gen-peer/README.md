# sim-gen-peer

The simulator's generated peer: another team's app, as far as [`apps/sim-gen`](../sim-gen) knows.
It serves widgets (each a root holding a tree of regions) and pages (a server router under `/peer`)
over fragment federation. `apps/sim-gen` renders its widgets and mounts its pages. Like `sim-gen`,
it is written from a seed by `internal/sim/src/gen.ts`.

Internal. Never published. Only `internal/sim` uses it, and only for seeds that draw a peer (about
half). Its regions are numbered from 1000, so its `n1003` is never the app's `n3`.

## What is in git, and what is not

Only the frame is committed: the config, `hooks.server.ts`, the root layout and page. Each seed
writes `src/lib/gen/`, which is gitignored. Do not commit it.

## Run

`pnpm --filter ogygia-internal-sim sim:gen --seed N` writes it when the seed draws a peer. Then
build it once, as a rules build:

```bash
cd apps/sim-gen-peer && OGYGIA_RULES=1 pnpm build
```

Then run the simulator on `apps/sim-gen`; it picks up the peer from that app's `plan.json`.

More: [`internal/notes/dst.md`](../../internal/notes/dst.md), "The random app".
