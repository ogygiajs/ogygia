---
'@ogygia/testing': minor
'@ogygia/devtools': patch
---

- `@ogygia/testing`: `testing()` from `@ogygia/testing/vite`, listed beside `ogygia()`, feeds the testing engine a test injects, so `page()`, `hydration()`, `record()` and `settled()` work without devtools in the app. A visitor runs nothing of it. `profile()` still needs `devtools({ profiler })`.
- `@ogygia/testing`: the injected engine starts the page beacon itself, so a page without the devtools server is measured too.
- `@ogygia/devtools`: with both the dock and `testing()` in an app, each runtime hook call is recorded and measured once.
