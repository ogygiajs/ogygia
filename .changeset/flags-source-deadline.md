---
'@ogygia/flags': patch
---

A flag source that does not answer within 1 second no longer holds the request: its flags fall to their native rule for that request and the failure is said (`flags_source_failed`). `openfeature()` and a custom source had no deadline, so one stalled provider stalled every page.
