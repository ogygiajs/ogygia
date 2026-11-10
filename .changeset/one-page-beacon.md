---
'@ogygia/devtools': patch
---

- `@ogygia/devtools`: one page beacon measures every profiled or dock-measured page, with or without the runtime: a Kit-hydrated page now reports the same visit an islands page does (long frames, the slowest interaction with its scripts, fonts, images, the CPU of an interaction), and the runtime's chunk no longer carries the page's vitals, long tasks or CPU sampler.
