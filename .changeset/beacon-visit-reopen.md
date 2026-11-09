---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

The profiler's visit beacons no longer take the first tab switch for the page leaving: coming back to the tab or a back/forward cache restore opens the visit again, so later navigations, interactions and shifts go out with the next hide, and the standalone beacon sends no copy after its final visit (#209).
