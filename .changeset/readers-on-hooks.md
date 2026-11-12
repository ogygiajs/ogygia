---
'@ogygia/core': patch
'@ogygia/devtools': patch
'@ogygia/insights': patch
---

- `@ogygia/core`: four new runtime hooks for a plugin's browser half: `regionWoke`, `regionMismatched`, `navStarted` and `loadStarted`; `navigated` now says whether the regions were `reconciled`, and `holeFailed` carries the hole's `el`.
- `@ogygia/devtools`: the dock's Page, Hydration and Session readers and the testing API read the runtime hooks instead of core's event layer.
- `@ogygia/insights`: a recorded session holds the runtime hook calls (`SessionData.hooks`, `HookEntry`) instead of core's events.
