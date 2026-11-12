# sim-gen

An app nobody writes by hand. The simulator's generator (`internal/sim/src/gen.ts`) writes its pages
and regions from a seed: regions on every schedule, holes, lakes and plain components, nested up to
three deep, on three to six pages with the router on. Then the simulator builds it and runs it. It
finds bugs in app shapes no one thought to write.

Internal. Never published. Only `internal/sim` uses it. About half the seeds also write a peer app
into [`apps/sim-gen-peer`](../sim-gen-peer), served to this one over fragment federation.

## What is in git, and what is not

Only the frame is committed: the config, `hooks.server.ts`, `hooks.ts`, `src/sim-client.ts` and the
real-browser spec in `e2e/`. Each seed writes `src/routes/` and `src/lib/gen/` (the tree is in
`src/lib/gen/plan.json`). Both are gitignored. Do not commit them, and do not hand-edit them: run the
generator again.

## Run

```bash
pnpm --filter ogygia-internal-sim sim:gen --seed 12   # write the app (and maybe its peer) for seed 12
pnpm sim:builds --app ../../apps/sim-gen               # two rules builds, for deploys
pnpm sim --app ../../apps/sim-gen                      # run the simulator on it
```

If the seed drew a peer, build the peer once first (see its README). The simulator reads the peer
from `plan.json`, so `pnpm sim` needs no extra flags.

To play saved simulator runs in real browsers:

```bash
SIM_PLANS=<plan.json>,... pnpm --filter sim-gen sim:browser --project chromium
```

That script is not called `e2e` on purpose: CI has no generated app to build.

More: [`internal/notes/dst.md`](../../internal/notes/dst.md), "The random app" and "The real-browser
tier".
