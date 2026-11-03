# @ogygia/federation

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A peer-cache refresh that answers an error no longer replaces the good document it was refreshing.
- Updated dependencies [[`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f)]:
  - @ogygia/core@0.11.0
  - @ogygia/router@0.11.0

## 0.0.0

Initialize package.
