---
'@ogygia/machine': minor
---

New `queue()`: a bounded, first-come queue. At most `max` jobs hold a place; a `release()` hands its place to the next job in the same step. A job can carry a deadline (all deadlines share one timer) or be cancelled, and the queue's `owner` closing makes the waiting jobs stale.
