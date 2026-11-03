# @ogygia/tsdown-plugin-svelte

## 1.1.1

### Patch Changes

- [#149](https://github.com/ogygiajs/ogygia/pull/149) [`6ffbce1`](https://github.com/ogygiajs/ogygia/commit/6ffbce1beb5a99574292723e12a3c13dc97d5580) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The README links to the package's new section of the docs at ogygiajs.dev.

- [#147](https://github.com/ogygiajs/ogygia/pull/147) [`20d79cb`](https://github.com/ogygiajs/ogygia/commit/20d79cb4dca0d5628333f8ee788277971c55eab1) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The README shows how to use the plugin in a plain rolldown build.

## 1.1.0

### Minor Changes

- [#64](https://github.com/ogygiajs/ogygia/pull/64) [`3bff299`](https://github.com/ogygiajs/ogygia/commit/3bff2999bf36c9fb9ae1cf3b7a9c04613cf0bd78) Thanks [@PuruVJ](https://github.com/PuruVJ)! - **Breaking:** features move into plugin packages, each a Vite plugin listed beside `ogygia()` and before `sveltekit()` (`plugins: [ogygia(), flags(), sveltekit()]`; out of order, or without `ogygia()`, the build says so): flags (`@ogygia/flags`, was `ogygia/flag`), frozen pages (`@ogygia/freeze`, was `ogygia/freeze` and `ogygia({ freeze })`), fragment federation (`@ogygia/federation`, was `ogygia/federation`; `mount` moved from `ogygia/router`) and content (`@ogygia/content`, was `ogygia/content*` and `ogygia({ content })`; `ogygia/content/server` is `@ogygia/content/server`, and the svelte config's `ogygia.preprocess()` / `ogygia.extensions()` are `preprocess()` / `extensions()` from `@ogygia/content/vite`), each with its factory from `<package>/vite`. The devtools dock and the profiler move to `@ogygia/devtools`: `ogygia({ devtools, profiler })` becomes `devtools({ dock, profiler })`, `ogygia/profiler*` imports become `@ogygia/devtools/profiler*` (`@ogygia/devtools/profiler`, `/profiler/client`, `/profiler/storage`, `/profiler/storage/sqlite|redis|postgres`), and the event layer `ogygia/devtools` exported is `ogygia/events` (with `ogygia/insights` beside it). `ogygia/testing` is `@ogygia/testing`. The server router is `@ogygia/router` (was `ogygia/router`; list `router()` from `@ogygia/router/vite` so its pages' CSS links — dev warns when a page renders without it), and its typed fetch client `ogygia/router/client` is `@ogygia/router/api` (`POST(schema, …)` endpoints now type-check, and `$infer` carries their verbs). An endpoint handler's `c.params` is now typed strictly by its table key, at the top level, inside `layout()` tables and behind `when()`, and its return type reaches `api()`; `GET<'/p'>(fn)` is gone (a handler written outside its table checks with `satisfies Handler<'/p'>`). A plugin is made with `definePlugin({ name, server, client, options, build })` from `ogygia/vite`, which returns a Vite plugin; its server and browser halves are named by location (`server: import.meta.resolve('./server.ts')`) instead of found by package export name. The command line lives in `@ogygia/cli` (`npx ogygia …` keeps working: `ogygia`'s bin runs it). `ogygia` is now a thin package over `@ogygia/core`; plugins depend on `@ogygia/core`. `ogygia()`'s region options sit at its root: `regions.visible`, `regions.presets`, `regions.ttl` and `regions.maxPageAge` are `visible`, `presets`, `ttl` and `maxPageAge`. `@ogygia/tsdown-plugin-svelte` turns a component's relative `./x.ts` imports into `./x.js` in the shipped component and its types, so sources can import with real extensions. Fixed: a Kit-hydrated (`csr = true`) page could link the stylesheets of every region in the app, depending on how the bundler grouped the server build (newer rolldown, under vite 8.3, did).

### Patch Changes

- [#64](https://github.com/ogygiajs/ogygia/pull/64) [`3bff299`](https://github.com/ogygiajs/ogygia/commit/3bff2999bf36c9fb9ae1cf3b7a9c04613cf0bd78) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Component types are emitted with `isolatedDeclarations` off, so a library that turns it on still gets its `.svelte.d.ts`; a new `tsconfig` option names the config to start from.

## 1.0.1

### Patch Changes

- [#65](https://github.com/ogygiajs/ogygia/pull/65) [`83ef60a`](https://github.com/ogygiajs/ogygia/commit/83ef60af76617a7c0ec8e47327cb027d5fea1c6b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The repository now lives at github.com/ogygiajs/ogygia; package links point there.

## 1.0.0

### Major Changes

- [#49](https://github.com/ogygiajs/ogygia/pull/49) [`81082a3`](https://github.com/ogygiajs/ogygia/commit/81082a3e9031d8e5a4ce1c278b9cf61c7adcae92) Thanks [@PuruVJ](https://github.com/PuruVJ)! - First stable release: ship a library's Svelte components from a tsdown build, uncompiled, with TypeScript stripped from script and template and a `.svelte.d.ts` beside each component.

## 0.0.0

Initialize package.
