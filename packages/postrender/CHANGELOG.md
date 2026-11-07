# @ogygia/postrender

## 0.13.0

### Minor Changes

- [#177](https://github.com/ogygiajs/ogygia/pull/177) [`d9e8e2f`](https://github.com/ogygiajs/ogygia/commit/d9e8e2f2b9bad0fa5d79a60d2b2001edc11985c6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Postrender's stores and edges are classes: `new MemoryStore()`, `new ValkeyStore(client)`, `new UpstashStore({ url, token })`, `new CloudflareKvStore(binding)`, `new AkamaiEdge(cfg)`, `new CloudFrontEdge(cfg)` and `new CloudflareEdge(cfg)` replace `memoryStore()`, `valkey()`, `upstash()`, `cloudflareKv()`, `akamai()`, `cloudfront()` / `awsCloudfront()` and `cloudflare()` (same arguments).

### Patch Changes

- [#175](https://github.com/ogygiajs/ogygia/pull/175) [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.
- Updated dependencies [[`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca), [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a), [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939), [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10)]:
  - @ogygia/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba)]:
  - @ogygia/core@0.12.0

## 0.11.4

### Patch Changes

- [#130](https://github.com/ogygiajs/ogygia/pull/130) [`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.
- Updated dependencies [[`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b)]:
  - @ogygia/core@0.11.4

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The deploy-thaw build marker no longer lapses after a day: it is stored apart from the page TTL and rewritten every boot.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A stored page older than the policy `ttl` is a miss on read, so a store without its own expiry still ages pages out.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A store that fails during invalidation is reported as a store failure, and the edges still purge (a throwing `evictByTag` stopped the whole invalidation and was blamed on the edge).

- Updated dependencies [[`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f)]:
  - @ogygia/core@0.11.0

## 0.0.0

Initialize package.
