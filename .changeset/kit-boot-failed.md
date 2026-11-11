---
'@ogygia/core': patch
---

An island waiting for SvelteKit on a csr=true page no longer waits forever when Kit's own client files fail to download: it fails, and the page says `kit_boot_failed` once.
