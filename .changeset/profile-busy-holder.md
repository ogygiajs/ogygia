---
'@ogygia/cli': patch
'@ogygia/devtools': patch
---

`ogygia_profile` no longer takes over someone else's live recording: the profiler's 409 says who holds the recorder and whether that holder is stale, and the tool resets only a stale one; a live one gets a "busy" message (#290).
