# @ogygia/core

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
