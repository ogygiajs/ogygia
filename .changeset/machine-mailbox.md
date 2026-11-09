---
'@ogygia/machine': minor
---

`mailbox()` runs one owner's events one at a time, in the order they came: a handler's turn lasts until it waits or ends, and the owner closing drops the queue and ends every wait with `STALE`.
