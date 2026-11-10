---
'@ogygia/core': patch
---

A shared chunk that fails to download on a large page (one whose resource timing buffer is already full) is asked for again once and then said once with `chunk_reload_needed`, instead of being retried on every wake without the message.
