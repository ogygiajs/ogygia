---
'@ogygia/machine': minor
---

`queue()` serves lines with more rules than first come: `priority(job)` (read again each pass, ties in the order pushed), `ready(job)` (a job not ready is passed over, the rest still start), `windows: [{ max, holds }]` (caps over some jobs, beside `max`), `budget: { ms, yield, defer?, settle? }` (a long drain hands the thread back), and `recheck()`. `max` is now optional, and a budget `yield` that throws is reported (`machine_queue_yield_failed`).
