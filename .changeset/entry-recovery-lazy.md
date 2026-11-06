---
'@ogygia/core': patch
---

A page whose island files all load no longer ships the deploy-rollover recovery (reading the current build's `ogygia.json` and retrying): it loads on the first island file that fails (about 0.2 KB brotli per island page).
