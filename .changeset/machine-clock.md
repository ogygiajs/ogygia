---
'@ogygia/machine': minor
---

New `clock` (`clock.mono()` for durations, `clock.wall()` for timestamps). A `flights()` keep and a retry `policy()` deadline are now measured on the monotonic clock, so a wall-clock step (an NTP correction, a VM resume) no longer shortens or stretches them.
