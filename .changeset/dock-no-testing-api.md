---
'@ogygia/devtools': minor
---

- `@ogygia/devtools`: breaking: the dock no longer installs `window.__ogygia_testing` or loads a testing engine of its own. `@ogygia/testing` injects its engine into every page; list `testing()` from `@ogygia/testing/vite` in the app under test (the dock alone still feeds an injected engine).
