---
'@ogygia/core': patch
---

A live region and a woken deferred island now adopt their server HTML: they were thrown away and re-rendered on the client every time they hydrated.
