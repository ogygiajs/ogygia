---
'@ogygia/compiler': patch
---

A build no longer prints `relocation_unpatched` for the fn manifest. The browser bundle carried a leftover `og.$` registration module whose contents the bundler always dropped; the page's inline manifest is what delivers the factories, so the module is gone.
