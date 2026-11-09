---
'@ogygia/core': patch
---

An island file that 404s is no longer asked for again under a fresh URL when the browser's timing entry for it lands late (Firefox on a busy machine): the loader waits for the entry, up to a second.
