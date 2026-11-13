---
'@ogygia/core': patch
---

Where there is no IntersectionObserver, a viewport watch still throws to its caller, but no longer leaves a broken tracker behind that fails every later watch and throws when the page's trackers end.
