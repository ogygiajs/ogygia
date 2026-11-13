---
'@ogygia/devtools': patch
---

The page tab no longer reports a content-named file as not cached when its cache check failed or was refused (a network error, a 405 for HEAD): such a file is left out of the finding.
