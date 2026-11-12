# @ogygia/config

The build and unit-test setup every ogygia package shares, so each package's config is a line or
two instead of a copy.

Internal. Never published. Every package under `packages/` except `@ogygia/tooling` and
`@ogygia/tsdown-plugin-svelte` uses it as a dev dependency.

## Entries

| import                     | what it gives you                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@ogygia/config/tsdown`    | `library()`: the shared tsdown build (ESM, one file per source file, `.d.ts` beside each)            |
| `@ogygia/config/vitest`    | `pluginTests()`: node tests with the Svelte plugin and core's stubs for `$app/*` and virtual modules |
| `@ogygia/config/sim`       | `simulate()`: seeded runs where fast-check picks the order async work finishes in                    |
| `@ogygia/config/html-fuzz` | generated HTML and parse5's reading of it, for differential tests (from `internal/html-fuzz`)        |

## Use

```ts
// packages/<name>/tsdown.config.ts
import { library } from '@ogygia/config/tsdown';

export default library();
```

```ts
// packages/<name>/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { pluginTests } from '@ogygia/config/vitest';

export default defineConfig(pluginTests());
```

`src/sim.ts` opens with a full example of `simulate.check()`, and lists the env vars that set the
seed and run count (`OGYGIA_SIM_SEED`, `OGYGIA_SIM_RUNS`).

## Work on it

```bash
pnpm --filter @ogygia/config check   # tsc
```

It has no tests of its own. Every package's build and tests use it, so a change here shows up there.
The e2e harness is a separate package, [`@ogygia/tooling`](../tooling).
