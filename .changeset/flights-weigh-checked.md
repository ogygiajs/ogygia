---
'@ogygia/machine': patch
---

A flights answer whose `weigh` is below 0 or not a number is not kept, so a bad weight can no longer lower the total and let `max` cap nothing (#355).
