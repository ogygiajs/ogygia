---
'@ogygia/insights': major
'@ogygia/core': major
---

- `@ogygia/insights`: new package, the analysis engine the devtools dock, the profiler's report and `@ogygia/testing` share (what the browser measured, turned into findings). `ogygia/insights` re-exports it with the same names.
- `@ogygia/core`: the `@ogygia/core/insights` import path is gone. Import from `ogygia/insights` (or `@ogygia/insights`) instead; the names are the same.
