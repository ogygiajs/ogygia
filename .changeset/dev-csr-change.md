---
'@ogygia/compiler': patch
---

In dev, a page whose `csr` changes while the server runs (an option file added, edited or removed above it) is compiled again for its new `csr`, so a page that becomes `csr = false` gets its regions without a restart (before, its marks stayed stripped and its regions never hydrated) (#1375).
