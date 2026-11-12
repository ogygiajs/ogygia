---
'@ogygia/devtools': minor
'@ogygia/core': patch
---

devtools: in production the profiler accepts only a secret of at least 16 bytes; a shorter one keeps its pages closed and says so (`devtools_profiler_secret_short`)
devtools: the profiler allows ten wrong keys per address in 15 minutes (the login form, `x-profiler-key` and `x-profile` share the count), then answers 429 until the window passes
devtools: a profiler login is a random session id the server signs; it expires after 12 hours, logout ends it, and any change to it is refused (everyone logs in once again after the upgrade)
devtools: the profiler's beacon flag cookie belongs to one login: it ends when that session expires or logs out
