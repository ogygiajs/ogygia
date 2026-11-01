# @ogygia/postrender

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The deploy-thaw build marker no longer lapses after a day: it is stored apart from the page TTL and rewritten every boot.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A stored page older than the policy `ttl` is a miss on read, so a store without its own expiry still ages pages out.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A store that fails during invalidation is reported as a store failure, and the edges still purge (a throwing `evictByTag` stopped the whole invalidation and was blamed on the edge).

- Updated dependencies [[`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38)]:
  - @ogygia/core@0.11.0

## 0.0.0

Initialize package.
