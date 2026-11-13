---
'@ogygia/devtools': patch
---

The profiler follows a prerendered redirect page however its meta refresh is written (single quotes, no quotes, spaces around `=`), and no longer takes text that only names one for a redirect.
