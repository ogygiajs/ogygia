# @ogygia/federation

## 0.13.0

### Patch Changes

- [#175](https://github.com/ogygiajs/ogygia/pull/175) [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.
- Updated dependencies [[`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca), [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a), [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa), [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939), [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7), [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10), [`1767110`](https://github.com/ogygiajs/ogygia/commit/1767110f67734bfaffdd6243b3fb3406292746d4)]:
  - @ogygia/core@0.13.0
  - @ogygia/router@0.13.0

## 0.12.0

### Patch Changes

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A remote fragment's island graph (its chunk preloads and portable snippets' locations) is pinned to the remote's origin like its attributes, so the shell no longer resolves it against its own files.
- Updated dependencies [[`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba), [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec), [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba)]:
  - @ogygia/core@0.12.0
  - @ogygia/router@0.12.0

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A peer-cache refresh that answers an error no longer replaces the good document it was refreshing.
- Updated dependencies [[`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f)]:
  - @ogygia/core@0.11.0
  - @ogygia/router@0.11.0

## 0.0.0

Initialize package.
