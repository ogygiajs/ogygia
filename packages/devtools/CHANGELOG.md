# @ogygia/devtools

## 0.11.1

### Patch Changes

- [#92](https://github.com/ogygiajs/ogygia/pull/92) [`2f00bdb`](https://github.com/ogygiajs/ogygia/commit/2f00bdb6749e13ccecefcf907bda50f9b46cc811) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/router` is a dependency of `@ogygia/devtools`, not an optional peer: the profiler's UI is rendered through it, so turning the profiler on no longer needs it installed by hand.
- Updated dependencies [[`aab90f7`](https://github.com/ogygiajs/ogygia/commit/aab90f7c2cf6bd15d17bdf9e293646cd9a8cc3ff)]:
  - @ogygia/core@0.11.1

## 0.11.0

### Patch Changes

- [#88](https://github.com/ogygiajs/ogygia/pull/88) [`7f1abd7`](https://github.com/ogygiajs/ogygia/commit/7f1abd74012a0bac985d93db2ef02e1a810d7a5e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler UI's display font is named Geist Serif, matching the docs site.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The profiler's sqlite, redis and postgres stores keep a whole recording window (2000 requests per key); they kept the newest 20.
- Updated dependencies [[`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38)]:
  - @ogygia/core@0.11.0
  - @ogygia/router@0.11.0

## 0.0.0

Initialize package.
