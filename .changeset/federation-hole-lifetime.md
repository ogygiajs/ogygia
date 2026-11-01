---
"@ogygia/federation": patch
"@ogygia/core": patch
---

Remote deferred holes now share local holes' lifetime and renewal: they were signed for a fixed 5 minutes and answered 410 after, so a stored or cached page older than that showed dead remote regions. Plugins sign with core's rule through `app.capability`.
