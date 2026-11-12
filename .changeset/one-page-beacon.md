---
'@ogygia/devtools': patch
---

- `@ogygia/devtools`: one page beacon measures every profiled or dock-measured page, with or without the runtime: a Kit-hydrated page now reports the same visit an islands page does (long frames, the slowest interaction with its scripts, fonts, images, the CPU of an interaction), and the runtime's chunk no longer carries the page's vitals, long tasks or CPU sampler.
- `@ogygia/devtools`: the dock starts the page beacon itself when the server did not put one in the page (an app without ogygia's `handle`), so its findings work there too: in dev at once, in a build (devtools switched on) as a small chunk loaded only then.
- `@ogygia/devtools`: when that chunk fails to download, the page says so once (`devtools_page_beacon_load_failed`) instead of going unmeasured in silence.
