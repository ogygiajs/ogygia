# @ogygia/core

## 0.11.5

### Patch Changes

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`93d23c4`](https://github.com/ogygiajs/ogygia/commit/93d23c44c44f3b4c52025e15b3005f5a744a1aa3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app with no deferred, live or lake region no longer ships the region element's fetch, apply and morph code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`93d23c4`](https://github.com/ogygiajs/ogygia/commit/93d23c44c44f3b4c52025e15b3005f5a744a1aa3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An island page no longer downloads runtime code for features its app does not use.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`93d23c4`](https://github.com/ogygiajs/ogygia/commit/93d23c44c44f3b4c52025e15b3005f5a744a1aa3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A `+page.md` route counts as a page like `+page.svelte`, so a csr=false markdown page no longer makes every island page ship extra Svelte and runtime code.

- [#144](https://github.com/ogygiajs/ogygia/pull/144) [`93d23c4`](https://github.com/ogygiajs/ogygia/commit/93d23c44c44f3b4c52025e15b3005f5a744a1aa3) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An app whose islands never read their page no longer ships the page seed runtime or the MPA navigation handle.

## 0.11.4

### Patch Changes

- [#130](https://github.com/ogygiajs/ogygia/pull/130) [`92457f4`](https://github.com/ogygiajs/ogygia/commit/92457f4ed7c9ad949b23a2e50c8d5a7e36cbbc60) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.

## 0.11.3

### Patch Changes

- [#118](https://github.com/ogygiajs/ogygia/pull/118) [`e845da3`](https://github.com/ogygiajs/ogygia/commit/e845da3e6c334a169ad0e228ffc2946ee60c90f9) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A web component around a hole is restored like one around an island, so its own runtime no longer adopts it and moves the hole it holds.

## 0.11.2

### Patch Changes

- [#107](https://github.com/ogygiajs/ogygia/pull/107) [`edd9613`](https://github.com/ogygiajs/ogygia/commit/edd9613a9a9afd0295eec1a98e20403e83b114d1) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The drop-in `setContext` now reaches islands inside a lake on a csr=true page; a csr=true page with no island ogygia wakes still ships no context.

## 0.11.1

### Patch Changes

- [#95](https://github.com/ogygiajs/ogygia/pull/95) [`aab90f7`](https://github.com/ogygiajs/ogygia/commit/aab90f7c2cf6bd15d17bdf9e293646cd9a8cc3ff) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The "uses ogygia marks, but its package declares no ogygia.files" warning fires only for a real marked import, not for a dependency whose comments, strings or error messages merely mention `with { wake }` (the plugin packages tripped it).

## 0.11.0

### Patch Changes

- [#83](https://github.com/ogygiajs/ogygia/pull/83) [`b0a6cd3`](https://github.com/ogygiajs/ogygia/commit/b0a6cd336627a7e34fdef0141131c3905ecfbd38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.

## 0.0.0

Initialize package.
