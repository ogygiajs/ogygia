---
'@ogygia/devtools': patch
---

A profiler trap or always-on sampler whose window the inspector refused now says so: the dashboard shows what the trap really caught, `stopped` with the reason, and a window started later no longer shows a stopped trap as armed; the stop is said once as `devtools_profiler_background_stopped` (#361).
