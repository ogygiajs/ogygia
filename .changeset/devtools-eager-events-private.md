---
'@ogygia/core': patch
---

A build that ships devtools events on every page (a plugin's `events()` without `lazy`) now marks each page `cache-control: private, no-store`, so a shared cache can't keep one visitor's server events and serve them to another.
