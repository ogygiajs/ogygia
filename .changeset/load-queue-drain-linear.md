---
'@ogygia/core': patch
---

`@ogygia/core`: draining the load queue reads each waiting download's class once instead of sorting the whole queue every time a download ends, so a big page spends less time picking what to fetch next, in the same order.
