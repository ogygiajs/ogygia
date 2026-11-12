---
'@ogygia/devtools': patch
---

devtools: a profiler window id is a signed capability: it expires after 10 minutes, is signed under a key derived for window ids alone, and is checked in constant time; dev with no secret signs under a key of its own process (ids from before this release no longer check)
