---
'@ogygia/devtools': patch
---

The profiler's sink posts go through an outbox, one at a time in order: rows read while a post is out are sent even when the profiler stands down meanwhile, a failed post is tried again before newer rows go (so a full buffer drops the oldest rows, not the newest), each post carries an `idempotency-key`, and a post never taken is said as `devtools_profiler_sink_undelivered` (#293).
