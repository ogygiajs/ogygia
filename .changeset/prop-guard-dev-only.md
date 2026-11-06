---
'@ogygia/core': patch
---

The island prop-mutation warning (a dev aid) no longer ships in production builds: its guard is created only in dev, so the bundler drops it (about 0.4 KB brotli per island page).
