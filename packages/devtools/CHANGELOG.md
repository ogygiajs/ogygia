# @ogygia/devtools

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
