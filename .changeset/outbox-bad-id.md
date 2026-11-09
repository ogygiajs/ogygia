---
'@ogygia/machine': patch
---

An outbox item whose `id` is not a string or a finite number (`undefined`, `NaN`) is not sent and is given up, instead of joining every other such item into one send (#350).
