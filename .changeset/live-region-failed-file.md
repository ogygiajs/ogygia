---
'@ogygia/core': patch
---

A live region whose island file cannot load stops trying on every tick: it says `island_load_failed` once, shows each later tick's server HTML, and no longer throws the import's error at the page or asks the server about the file again.
