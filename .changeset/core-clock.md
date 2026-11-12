---
'@ogygia/core': patch
---

Render deadlines, the region endpoint's rate-limit windows, a lake's `maxAge` and the page-asset budget are now measured on the monotonic clock, so a wall-clock step (an NTP correction, a VM resume) no longer shortens or stretches them.
