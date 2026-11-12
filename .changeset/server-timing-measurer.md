---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

A region answer's `server-timing` (queue and render time) goes only to dev, a browser that turned devtools on, or the profiler's logged-in user; the profiler's beacon flag cookie now carries a value signed under the profiler secret, and a bare `1` no longer turns it on
