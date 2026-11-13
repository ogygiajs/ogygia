---
'@ogygia/devtools': patch
---

The profiler's browser store closes its database connection when a read or write fails, so a failed one no longer blocks later opens of the store.
