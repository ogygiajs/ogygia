# internal/heisenbench

The glue between ogygia's bench files (`packages/<name>/bench/*.bench.ts`) and
[Heisenbench](https://github.com/ogygiajs/bench/tree/main/packages/heisenbench), the engine that
counts them. Heisenbench counts exact steps, allocations and calls per function. It does not time
anything.

Internal. Never published. Heisenbench itself is not on npm: `src/heisenbench.ts` links it from a
clone of `ogygiajs/bench`, at the commit pinned under `heisenbench.ref` in this package's
`package.json`. The clone lives in the gitignored `.heisenbench/` at the repository root. Set
`HEISENBENCH_DIR` to use a checkout of your own.

## What is here

| file                | does                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `src/types.ts`      | writes the types a bench file needs to reach a module's private functions (`__heisenbench`) |
| `src/check.ts`      | type-checks every package's bench files                                                     |
| `src/unmeasured.ts` | the measurement-source gate: a new function with no bench and no replayable test fails it   |
| `src/preload.ts`    | loaded before a bench run: points `ogygia:*` and `$app/*` at core's test stubs              |
| `src/record*.ts`    | records the inputs unit tests pass to unmeasured functions, so the gate can replay them     |
| `src/stale.ts`      | finds exemptions that name a function that no longer exists                                 |
| `unmeasured.json`   | the exemptions: functions the gate lets pass, each with a reason                            |

## Run

From the repository root:

```bash
pnpm bench:types                     # write the bench files' types
pnpm check:bench                     # type-check the bench files
pnpm bench:unmeasured --base main    # the gate: fails on new unmeasured functions only
pnpm --filter ogygia-internal-heisenbench test
```

Run the gate before you push a change that adds functions. An exemption in `unmeasured.json` needs
a real reason. The gate also fails on a stale one, so delete it when its function goes away.

The bench runs on every PR happen in [ogygiajs/bench](https://github.com/ogygiajs/bench). See
CONTRIBUTING.md, "Bench files".
