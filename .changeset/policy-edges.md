---
'@ogygia/machine': patch
---

A retry that stops because its next wait would end past the deadline fails with a `TimeoutError` (the last error in its message), and a policy's wait is always a number, also for a count of 0 or a 0 backoff after very many tries (#359).
