---
'@ogygia/core': patch
---

A plugin's `done` that throws, or whose work fails after the response, now prints `plugin_hook_failed` with the error, instead of nothing; the response still never fails on it.
