---
'@ogygia/core': patch
---

A region that leaves the page while its answer waits on its stylesheet no longer stays "painting" for good: its paint ends with the region. In dev and in `OGYGIA_RULES=1` builds, a new rule `rule_region_left_busy` reports a region that left the page with one of its machines still mid-work.
