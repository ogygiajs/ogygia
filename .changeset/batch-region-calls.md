---
'@ogygia/core': patch
---

Holes that start together are batched only with region calls of their own endpoint path; a plugin's hole (a deferred peer widget) goes on its own instead of being posted to the wrong endpoint and refused.
