# internal/sim

The simulator. One seed drives a whole ogygia app: its servers, its visitors' tabs, the network
between them, the CDN, deploys and time. A failing seed replays the same run, step for step. It finds
races and odd orderings that hand-written tests do not think of.

Internal. Never published. It runs built apps: the palaestra by default, `apps/sim-gen` (an app
written from a seed), `apps/sim-gen-peer`, and the `examples/mfe` apps.

The full story (the layers, the faults, the oracles, how to add one) is in
[`internal/notes/dst.md`](../notes/dst.md). Read it before you change anything here.

## Run

The app must be built first, with ogygia's rules on. `pnpm sim:builds` makes two such builds (v1
and v2), so a run can deploy between them. One `OGYGIA_RULES=1` build also works; it just never
deploys. From the repository root:

```bash
pnpm sim:builds                   # build the palaestra twice, as rules builds
pnpm sim                          # 20 seeds, 12 actions each, on the palaestra
pnpm sim --seed 7                 # one seed, replayed exactly
pnpm sim --seed 7 --step 4        # stop after action 4 and print its trace
pnpm sim --runs 200 --steps 30    # more
pnpm sim:long                     # the nightly size
```

`--app <dir>` picks another app. The path is relative to `internal/sim`.

The generated app:

```bash
pnpm --filter ogygia-internal-sim sim:gen --seed 12   # write apps/sim-gen (and maybe its peer)
pnpm sim:builds --app ../../apps/sim-gen
pnpm sim --app ../../apps/sim-gen
```

The simulator's own tests:

```bash
pnpm --filter ogygia-internal-sim test    # vitest (needs --experimental-vm-modules, set in the config)
pnpm --filter ogygia-internal-sim check   # tsc, then vitest
```

## Things to know

- Every seed runs twice, in two processes, and the traces must match byte for byte. A difference
  is a bug in the simulator. Fix it before you trust anything that seed found.
- A built app boots core's runtime from `packages/core/dist`, not from `src`. After a change to the
  runtime, run `pnpm build:lib` before `pnpm sim:builds`.
- `results.json`, `dst-results.json` and `plans/` are written by runs. They are gitignored; do not
  commit them.
- `steps.json` is the ledger of every state machine step (reached, covered by a named test, or dead).
  `mutants.json` lists the mutants the daily mutation run tries. `sweep-plans/` holds saved runs the
  sweep replays.
- A new finding from the scheduled run gets an issue and a seeded test in `test/found/`.
- `.github/workflows/dst.yml` runs it on a schedule (every 6 hours), never on a PR.
