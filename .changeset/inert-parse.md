---
'@ogygia/core': patch
---

A region or hole answer is parsed in a document with no browsing context, so no engine builds its custom elements before the restore (Firefox 159 did, and the page showed a component's server render twice); a host a component runtime upgraded first keeps its own root, gets its light DOM back without the server's copy, and says `restore_late` in every build (#382).
