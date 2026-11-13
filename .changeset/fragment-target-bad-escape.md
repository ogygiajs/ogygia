---
'@ogygia/core': patch
---

A router link whose hash is a bad percent escape (`#%E0`) no longer breaks the navigation after the swap: the router finds the hash target as the browser does (the hash as written first, then decoded, never throwing), so after hooks and `og:page-load` run and the router goes idle.
