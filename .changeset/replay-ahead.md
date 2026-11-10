---
'@ogygia/core': patch
---

An island clicked before it wakes no longer waits for the click-replay code to download: that small chunk is fetched as background work once an island is armed (after the page's critical resources), instead of at the click.
