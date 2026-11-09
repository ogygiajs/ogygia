---
'@ogygia/devtools': patch
---

After the hooks run again in dev, the new profiler sees every outbound fetch and http call, and http is wrapped once (#285).
