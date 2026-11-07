# @ogygia/core

## 0.13.0

### Minor Changes

- [#174](https://github.com/ogygiajs/ogygia/pull/174) [`413e77f`](https://github.com/ogygiajs/ogygia/commit/413e77f339c19a394ea7582685ed04d5858bf352) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page discloses which ogygia it runs on `window.__ogygia.v` (a Set of versions, as Svelte's `window.__svelte.v`), on csr=false and csr=true pages alike.

- [#175](https://github.com/ogygiajs/ogygia/pull/175) [`a99a49a`](https://github.com/ogygiajs/ogygia/commit/a99a49a724ecd61ee0e1388a4e659732a73f5939) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.

### Patch Changes

- [#186](https://github.com/ogygiajs/ogygia/pull/186) [`01dc5b9`](https://github.com/ogygiajs/ogygia/commit/01dc5b99c13cba0e30a96b0ff765865096a76dca) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Compiling a page with many regions is up to 1.9x faster: each region import no longer walks the whole file again to learn whether it is used.

- [#169](https://github.com/ogygiajs/ogygia/pull/169) [`e8cd9f7`](https://github.com/ogygiajs/ogygia/commit/e8cd9f7b9cf0695c4d287283d34ce258ef71c10a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page whose islands get plain JSON props no longer downloads devalue: it loads only when a props sidecar, the page seed or page facts are in devalue's lane, beside the hydrate code (about 2 KB brotli off each island page of the benchmark).

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The build's flag inventory takes time in line with a module's size: each flag's line is found from one pass over the file, not counted again from the top.

- [#173](https://github.com/ogygiajs/ogygia/pull/173) [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Islands hydrate the component itself instead of through a wrapper component: an island page ships less Svelte (about 0.3–0.4 KB brotli), and a placed island's server markup carries one marker pair fewer.

- [#187](https://github.com/ogygiajs/ogygia/pull/187) [`b46798f`](https://github.com/ogygiajs/ogygia/commit/b46798f90c26830c7f4eab0daf64602dee89edaa) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Finding the images that downloaded beside a page's largest paint takes time in line with its images.

- [#170](https://github.com/ogygiajs/ogygia/pull/170) [`6a63ecf`](https://github.com/ogygiajs/ogygia/commit/6a63ecf2d7e281ca739121de0219b65c4c4d53a7) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The island prop-mutation warning (a dev aid) no longer ships in production builds: its guard is created only in dev, so the bundler drops it (about 0.4 KB brotli per island page).

- [#173](https://github.com/ogygiajs/ogygia/pull/173) [`e7c31c0`](https://github.com/ogygiajs/ogygia/commit/e7c31c0d32dae5a525c417b9d3936bc3775f5b10) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A live region and a woken deferred island now adopt their server HTML: they were thrown away and re-rendered on the client every time they hydrated.

## 0.12.3

### Patch Changes

- [#166](https://github.com/ogygiajs/ogygia/pull/166) [`a2eade9`](https://github.com/ogygiajs/ogygia/commit/a2eade9cebe01c844d8ba3106945acadf05b10a8) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A component a markdown page imports is styled on a csr=false page: its scoped CSS (and any style file it imports) now ships in the page's content stylesheet beside the page's own `<style>`.

## 0.12.2

### Patch Changes

- [#164](https://github.com/ogygiajs/ogygia/pull/164) [`2a4dc9c`](https://github.com/ogygiajs/ogygia/commit/2a4dc9c9d83adf14c56b1ae714a7044088b7b8ff) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `ogygia.extensions()` and `ogygia.preprocess()` from `ogygia/vite` are callable again and do nothing (`['.svelte']` and `[]`), so a svelte config written for 0.8 loads; the markdown ones come from `@ogygia/content/vite`.

## 0.12.1

### Patch Changes

- [#162](https://github.com/ogygiajs/ogygia/pull/162) [`0f2f6d6`](https://github.com/ogygiajs/ogygia/commit/0f2f6d679562cfc1774c645a8a31a06e17070b76) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `render: 'deferred'` hole timed with `wake` builds again: `wake` times it as `fetch` does, and the build warns with the `fetch` to write.

## 0.12.0

### Minor Changes

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island loaded without a `src` (a region the browser renders, a held or live region from a remote function or a stream, a hole rebuilt after a failed hydration, a portable snippet with no island graph) loads its content-hashed file: the build writes its locations into one content-hashed map, which the runtime's script names and the first such load reads.

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A client-side navigation into a page of another build (a deploy since the page was loaded) loads that page as a document instead of swapping it into the running runtime, so two builds' islands, runtimes and Svelte never meet on one page.

- [#157](https://github.com/ogygiajs/ogygia/pull/157) [`a217b91`](https://github.com/ogygiajs/ogygia/commit/a217b91317cd1958a40c74a6009d2ce0c64226ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Every file a build writes under `<appDir>/immutable/` is now named by its content, so a host's year-long rule for that directory can never serve another build's code: the stable-name files (`og-region.<id>.js`, `og-runtime.<id>.js`), whose content changed every build, are gone. An island's `entry` is now a name, not a file. The one file at a fixed name is `<appDir>/ogygia.json`, beside Kit's `version.json`: the current build's locations, which a page that outlived its build reads to wake its islands on the current code. Serve it as you serve `version.json` (revalidated); a federated app also needs the same `Access-Control-Allow-Origin` on it as on its `immutable/` files. A page cached from before content hashing, which loaded the runtime by its stable name, no longer recovers.

### Patch Changes

- [#151](https://github.com/ogygiajs/ogygia/pull/151) [`64f6046`](https://github.com/ogygiajs/ogygia/commit/64f6046512f0cea076b2094d16ed75d4e1c726d3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A client-side navigation no longer removes nodes the page's own code put in `<body>` (a popover portal's anchor, a toast host), so a popover in an island the navigation keeps still opens afterwards; only the server's body children and attributes are replaced.

- [`75a5cdd`](https://github.com/ogygiajs/ogygia/commit/75a5cdd66de1b96f45585119b03f2ba4fc7a03ec) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `handle({ secret })` signs region capabilities with a secret the app passes (e.g. from `$env/static/private`), for a server that never sees `OGYGIA_SECRET` at runtime; it signs exactly as the same `OGYGIA_SECRET` does, and every copy of ogygia in the process uses it.

## 0.11.5

### Patch Changes

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app with no deferred, live or lake region no longer ships the region element's fetch, apply and morph code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island page no longer downloads runtime code for features its app does not use.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `+page.md` route counts as a page like `+page.svelte`, so a csr=false markdown page no longer makes every island page ship extra Svelte and runtime code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`cdd2ec0`](https://github.com/ogygiajs/ogygia/commit/cdd2ec03fe5c1fa0f947c6d8667de21724abaf38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app whose islands never read their page no longer ships the page seed runtime or the MPA navigation handle.

## 0.11.4

### Patch Changes

- [#130](https://github.com/ogygiajs/ogygia/pull/130) [`fede66a`](https://github.com/ogygiajs/ogygia/commit/fede66ae685497399a257cb2a498516364e8064b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.

## 0.11.3

### Patch Changes

- [#118](https://github.com/ogygiajs/ogygia/pull/118) [`acce10a`](https://github.com/ogygiajs/ogygia/commit/acce10a8eeebae3abc5289de577a302666bec8a5) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A web component around a hole is restored like one around an island, so its own runtime no longer adopts it and moves the hole it holds.

## 0.11.2

### Patch Changes

- [#107](https://github.com/ogygiajs/ogygia/pull/107) [`a83fe25`](https://github.com/ogygiajs/ogygia/commit/a83fe2574bab6e098d292e4486fc5dea9e32bca5) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The drop-in `setContext` now reaches islands inside a lake on a csr=true page; a csr=true page with no island ogygia wakes still ships no context.

## 0.11.1

### Patch Changes

- [#95](https://github.com/ogygiajs/ogygia/pull/95) [`0eced1d`](https://github.com/ogygiajs/ogygia/commit/0eced1d4dc1bd1e5c3507bea40d6aab308099c2a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The "uses ogygia marks, but its package declares no ogygia.files" warning fires only for a real marked import, not for a dependency whose comments, strings or error messages merely mention `with { wake }` (the plugin packages tripped it).

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`e229a9a`](https://github.com/ogygiajs/ogygia/commit/e229a9a326d2f7f8cd429ed8841c10d96763b57f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.

## 0.0.0

Initialize package.
