---
'@ogygia/machine': patch
---

- `@ogygia/machine`: `cache()` and `registry()` are smaller in a bundle (about 240 B brotli off a page's boot), and a bundle that uses `registry()` no longer carries `defineRun()` and `defining()`.
