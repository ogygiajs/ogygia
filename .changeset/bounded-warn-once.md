---
'@ogygia/machine': minor
'@ogygia/core': patch
'@ogygia/flags': patch
---

`say()` in `@ogygia/machine` says a thing once per key until it recovers, remembering at most 1024 keys; a machine's warn-once and a plugin's `warn` use it, so a long-lived server no longer keeps every distinct warning text.
