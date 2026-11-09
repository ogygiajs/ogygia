---
'@ogygia/core': patch
---

A request's owned work now stops at once when its answer is a HEAD or a page SvelteKit turns into a 304, instead of running until the visitor leaves (#320).
