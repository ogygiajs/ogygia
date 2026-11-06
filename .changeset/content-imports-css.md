---
'@ogygia/core': patch
'@ogygia/content': patch
---

A component a markdown page imports is styled on a csr=false page: its scoped CSS (and any style file it imports) now ships in the page's content stylesheet beside the page's own `<style>`.
