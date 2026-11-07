# @ogygia/devtools

## 0.13.0

### Minor Changes

- [#177](https://github.com/ogygiajs/ogygia/pull/177) [`d9e8e2f`](https://github.com/ogygiajs/ogygia/commit/d9e8e2f2b9bad0fa5d79a60d2b2001edc11985c6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler's stores are classes: `new MemoryStore()`, `new SqliteStore()`, `new RedisStore()` and `new PostgresStore()` replace `memoryStore()`, `sqliteStore()`, `redisStore()` and `postgresStore()` (same arguments, same entry points).

### Patch Changes

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding a load's constant work takes time in line with the load's lines: the functions it also calls elsewhere are read from one pass.

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding what ran at each garbage-collection pause takes time in line with the profile's pauses and timeline.

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding a load's constant work takes time in line with the file's helpers: a helper that answers per call marks the helpers that call it, with no pass over every helper again.

- [#175](https://github.com/ogygiajs/ogygia/pull/175) [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.

- [#184](https://github.com/ogygiajs/ogygia/pull/184) [`1767110`](https://github.com/ogygiajs/ogygia/commit/1767110f67734bfaffdd6243b3fb3406292746d4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Packages declare `sideEffects` (only their `.css` files run on import), so bundlers drop the modules an app never uses.

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding the waits in a row of a line takes time in line with its calls: the calls that started together are found from one sort.
- Updated dependencies [[`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca), [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a), [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939), [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`1767110`](https://github.com/ogygiajs/ogygia/commit/1767110f67734bfaffdd6243b3fb3406292746d4)]:
  - @ogygia/core@0.13.0
  - @ogygia/router@0.13.0

## 0.12.0

### Patch Changes

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler's standalone report inlines each island by the file its `src` names, so its islands wake offline.
- Updated dependencies [[`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba)]:
  - @ogygia/core@0.12.0
  - @ogygia/router@0.12.0

## 0.11.4

### Patch Changes

- [#130](https://github.com/ogygiajs/ogygia/pull/130) [`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.
- Updated dependencies [[`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b)]:
  - @ogygia/core@0.11.4

## 0.11.1

### Patch Changes

- [#92](https://github.com/ogygiajs/ogygia/pull/92) [`cd78e78`](https://github.com/ogygiajs/ogygia/commit/cd78e781c0175a119adb84b4cd1ed11da63fec72) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/router` is a dependency of `@ogygia/devtools`, not an optional peer: the profiler's UI is rendered through it, so turning the profiler on no longer needs it installed by hand.
- Updated dependencies [[`0eced1d`](https://github.com/ogygiajs/ogygia/commit/0eced1d4dc1bd1e5c3507bea40d6aab308099c2a)]:
  - @ogygia/core@0.11.1

## 0.11.0

### Patch Changes

- [#88](https://github.com/ogygiajs/ogygia/pull/88) [`24c2845`](https://github.com/ogygiajs/ogygia/commit/24c28450809d621d383b908428c2a4ce78f355c4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler UI's display font is named Geist Serif, matching the docs site.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler's sqlite, redis and postgres stores keep a whole recording window (2000 requests per key); they kept the newest 20.
- Updated dependencies [[`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f)]:
  - @ogygia/core@0.11.0
  - @ogygia/router@0.11.0

## 0.0.0

Initialize package.
