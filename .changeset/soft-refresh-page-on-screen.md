---
'@ogygia/core': patch
---

`invalidateAll` during a navigation refreshes the page on screen, not the page the navigation is still bringing, and a navigation that goes in ends a refresh still out (#268).
