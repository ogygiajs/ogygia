---
'@ogygia/core': patch
---

An island waiting for SvelteKit no longer imports a file named by a boot-shaped inline script that came in as markup: only files on the page's or the runtime's origin are imported.
