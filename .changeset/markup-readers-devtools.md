---
'@ogygia/devtools': patch
---

The profiler's byte breakdown, page seed and standalone export read the page as a browser does: tags inside comments are ignored, and quoted `>`, single quotes and upper-case attributes no longer mislead them.
