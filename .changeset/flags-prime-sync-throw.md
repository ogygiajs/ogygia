---
'@ogygia/flags': patch
---

A flag source that throws before it awaits anything leaves the request resolved (every flag on its native rule), instead of priming for good (#374).
