---
'@ogygia/rewrite': minor
'@ogygia/core': minor
'ogygia': minor
'@ogygia/devtools': patch
---

- breaking: an app's own pass over the HTML ogygia sends is the new `@ogygia/rewrite` package. `ogygia.handle({ transform })` now throws `handle_transform_moved`; list `rewrite()` (from `@ogygia/rewrite/vite`, no options) beside `ogygia()`, and put a `rewrite()` handle before `ogygia.handle()` in `sequence()`. `ogygia/markup` is removed, and `scanRegions` / `liftRegions` / `restoreRegions` leave `ogygia/server`.
- `@ogygia/rewrite`: `rewrite({ match, render })` renders only the outermost custom elements `match` picks (a tag prefix, a list of tags, or a test), in one `render(elements, ctx)` call per chunk of the page and per region answer, so a streamed page keeps streaming and its later chunks are rendered too.
- `@ogygia/rewrite`: each element `render` gets has ogygia's marks numbered from 0, so a cache can key on its bytes; equal elements in one call are rendered once.
- `@ogygia/rewrite`: `ctx` carries `kind`, `csr`, `url`, `event` and `signal`, an AbortSignal that fires when the request is cancelled.
- `@ogygia/rewrite`: a render's `sheets` go out once per key per response, into the head while it is open and inline before the first element that needs them after.
- `@ogygia/rewrite`: a failed batch is retried one element at a time; an element that still fails, drops ogygia's marks, or returns HTML that does not close what it opens goes out as ogygia rendered it, with a warning in every build (`rewrite_element_failed`, `rewrite_marks_lost`), never thrown.
- `@ogygia/rewrite`: an element split across streamed chunks goes out unrendered, said in dev (`rewrite_element_split`).
- `@ogygia/rewrite`: several rewrites in `sequence()` run in order on one marking of the HTML; one listed after `ogygia.handle()` throws `rewrite_after_ogygia`, and a rewrite without the plugin throws `rewrite_plugin_missing`.
- `@ogygia/rewrite`: `rewrite({ page })` rewrites the whole document (held until its last chunk) or region answer, says `rewrite_page_failed` when it throws (thrown in dev), and has `.html(str)` for a plain string.
- `@ogygia/rewrite`: `.check(html, { kind, csr })` runs the whole round trip on one piece of markup for a test, listing failures and, with a DOM, every restored element that differs from Svelte's.
- `@ogygia/rewrite`: a page where nothing was restored ships no restorer, and each streamed chunk that restored something ends with one short restore call.
- `@ogygia/devtools`: the profiler reads a page's regions itself and no longer depends on `@ogygia/rewrite`.
