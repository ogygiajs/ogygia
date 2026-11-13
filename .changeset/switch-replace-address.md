---
'@ogygia/core': patch
---

The router reads the address bar for the page on screen, so a page script's own `history.replaceState` (stripping tracking params, or devtools' `?og-devtools=on|off` switch) no longer leaves it remembering the old address for a refresh, a fragment link or a back step.
