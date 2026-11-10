---
'@ogygia/machine': minor
---

New `queue()`: jobs start when there is room (`max`, `holds`, an `admit` gate), the highest priority first (a getter re-read at each drain, a flight's raise moves its job up), with an optional time budget per drain, deadlines and an owner scope that settle a waiting job `STALE`.
