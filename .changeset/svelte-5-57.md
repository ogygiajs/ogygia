---
'@ogygia/core': patch
---

ogygia is now built and tested on Svelte 5.57.3. On Svelte 5.56, a held region whose query fails after another one failed throws a TypeError from inside Svelte; upgrade to 5.57 to avoid it.
