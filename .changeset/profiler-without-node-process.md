---
'@ogygia/devtools': patch
---

The SSR profiler no longer fails every request on a runtime without Node's process API (`process.cpuUsage`) or `node:inspector`: requests are answered and logged without CPU time, recordings are refused, and the profiler says so once (`devtools_profiler_runtime_unsupported`).
