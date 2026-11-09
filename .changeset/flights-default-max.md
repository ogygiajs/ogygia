---
'@ogygia/machine': minor
---

`flights()` now keeps at most 1000 answers by default (the least recently used go first); pass `max` to change it. A `cache()` or `flights()` `max` must be a finite number.
