---
'@ogygia/devtools': patch
---

The profiler login's `next` is read as a URL and kept only on the app's origin and under the profiler's path, so a profiler mounted at the root (`path: ''`) no longer sends a logged-in user to another site.
