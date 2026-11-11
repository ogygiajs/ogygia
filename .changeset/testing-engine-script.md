---
'@ogygia/testing': minor
'@ogygia/devtools': patch
---

- `@ogygia/testing`: `withOgygia` injects its own copy of the testing engine into each page before it loads (one bundled script, Playwright's `addInitScript`), so the engine always matches the package's version. `page().self.bytes` is 0 then (the page downloads none of it), and `page().self.phases.engine` is the engine's own start.
- `@ogygia/devtools`: the dock's realm lends the injected engine what only the app's build knows (dev or not, the regions' names, the props lookup), and the leftovers watch keeps one record per page that any copy of the readers can read.
