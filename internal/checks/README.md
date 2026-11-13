# internal checks

Scripts we run by hand (or from an agent loop) to check ogygia's own tools and costs. None of them
ship, and only the ones under "Run in CI" run in CI. Each script's header says what it checks and how to run it; run
them from the repository root, for example `node internal/checks/all-keys.ts`.

The framework benchmark (ogygia against SvelteKit, Astro and Mochi, Lighthouse and bytes) no longer
lives here. It moved to its own public repository,
[ogygiajs/bench](https://github.com/ogygiajs/bench), which benchmarks every ogygia pull
request and every push to `main`.

## Run in CI

`*.test.ts` files here run with `pnpm lint:test`, which CI runs.

| script              | checks                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `attack-surface.ts` | `internal/notes/ATTACK-SURFACE.md` is the map the code makes now: run it after a change |

## Answer keys

An answer key plants known problems on a page of the devtools lab (`packages/devtools/e2e/app`)
and checks that the devtools or the profiler name exactly those, and nothing on the decoys.

| script                    | checks                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `all-keys.ts`             | every key below, each with the server it wants (`--quick`: dev keys)   |
| `devtools-answer-key.ts`  | the devtools Page tab finds each planted island problem                |
| `devtools-session-key.ts` | the Record tab names each planted problem in a recorded session        |
| `devtools-a11y-check.ts`  | the dock itself: axe and text contrast on every tab                    |
| `devtools-click-check.ts` | every clickable thing in the dock does something and throws nothing    |
| `devtools-build-check.ts` | devtools in a build stay off until the visitor's browser turns them on |
| `profiler-answer-key.ts`  | the profiler finds each `PATTERN` comment and flags no `DECOY`         |
| `profiler-browser-key.ts` | what a visiting browser measures reaches the profiler's report         |
| `profiler-score-key.ts`   | the page score ranks a fully hydrated page below its island twin       |
| `profiler-click-check.ts` | every control on the profiler's pages does something                   |
| `profiler-links-check.ts` | every "show the row" link in a report opens a row                      |
| `profiler-sweep.ts`       | every lab route profiles without a crash or a misplaced pattern        |
| `cache-bust-check.ts`     | an `immutable` cache never serves the last build's code after a deploy |

## Compiler

| script                         | checks                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| `compiler-stress.ts`           | repeated real builds: transform time, byte determinism, cache hits   |
| `compiler-micro.ts`            | pathological inputs straight into the transform: no blowup           |
| `integration-prop-contract.ts` | island props survive the server to client trip, and cannot escape it |

## Comments sweep (#512)

| script            | does                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `comments.ts`     | lists what `ogygia/structured-comments` reports under a path (`--table`: PR rows) |
| `flip.ts`         | breaks one line on purpose, runs a test command, wants red, puts the line back    |
| `new-comments.ts` | fails on a comment the change adds that the rule reports (CI `check`, PRs)        |

The rule's own tests: `pnpm lint:test`.

## Costs

| script           | measures                                                                    |
| ---------------- | --------------------------------------------------------------------------- |
| `server-cost.ts` | ogygia's per-request server cost on palaestra's `/bench-cms` vs its twin    |
| `client-boot.ts` | main-thread cost and hydration time of the same page in a throttled browser |

`results/` keeps the last numbers worth comparing against: `server-cost-latest.md` and the heavy
profiler report `hell-profile*`. `results/server-cost-prof/` is the CPU profile `server-cost.ts`
writes; it is not committed.
