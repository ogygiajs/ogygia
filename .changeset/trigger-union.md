---
'@ogygia/core': patch
---

A hole fetched on `interaction` and kept as a live region revalidates on load after a remount, instead of waiting on a media query named `interaction` that never matches.
