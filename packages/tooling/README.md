# @ogygia/tooling

The e2e harness every ogygia suite shares: the Playwright config, the `test` fixture, `check()`,
the server spawner and the shared regexes. Also a Vitest setup that prints a failing test's state
machine moves.

Internal. Never published. Used by the e2e suites of `core` (through the palaestra), `router`,
`content`, `devtools`, `federation`, `postrender`, `reshape` and `testing`, by `apps/docs`,
`apps/sim-gen` and `internal/sim`. The build and unit-test config is a separate package,
[`@ogygia/config`](../config).

## Entries

| import                               | what it gives you                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `@ogygia/tooling/e2e`                | `test`, `expect`, `check()`, `sleep()` and small page helpers                     |
| `@ogygia/tooling/e2e/config.ts`      | `suite()`: a package's whole `playwright.config.ts`                               |
| `@ogygia/tooling/e2e/servers.ts`     | `spawn_server()`, `port()`: boot a dev server, a build or an emulator from a spec |
| `@ogygia/tooling/e2e/re.ts`          | the regexes the specs share                                                       |
| `@ogygia/tooling/e2e/packed.ts`      | pack `ogygia` into a tarball and install it, for specs that test the real package |
| `@ogygia/tooling/e2e/sim-replay.ts`  | plays a simulator plan in a real browser (see `internal/notes/dst.md`)            |
| `@ogygia/tooling/vitest/trace-setup` | a Vitest setup file: a failing test prints its machine moves                      |

## Use

A package's suite config:

```ts
// packages/router/playwright.config.ts
import { suite } from '@ogygia/tooling/e2e/config.ts';
import { fileURLToPath } from 'node:url';

export default suite({
	port: 3054,
	serve: fileURLToPath(new URL('./e2e/app', import.meta.url)),
	ready: '/rtr/'
});
```

A spec (from `apps/palaestra/e2e/subpkg-island.spec.ts`). `check()` is a named soft assertion: every
check runs, and the test fails once at the end. The `page` fixture also fails the test when ogygia's
rules are broken on the page, and prints the machine moves when it fails.

```ts
import { test, check } from '@ogygia/tooling/e2e';

test('SSR: the sub-package island rendered', async ({ baseURL }) => {
	const raw = await (await fetch(`${baseURL}/subpkg-island`)).text();
	check('SSR: sub-package island host rendered', SUBPKG_TOOLBAR_RE.test(raw));
	check('SSR: sub-package island present', SUBPKG_ISLAND_RE.test(raw));
});
```

## Run

```bash
pnpm test:e2e                            # every suite side by side (packages/tooling/src/e2e/run.ts)
pnpm --filter @ogygia/tooling test       # this package's own tests
pnpm --filter @ogygia/tooling check      # tsc, then vitest
```

`test/package-boundaries.test.ts` lives here too. It keeps `ogygia` depending on
`@ogygia/core` and `@ogygia/compiler` only. See CONTRIBUTING.md, "Verifying a change", for the rest
of the e2e commands.
