---
'@ogygia/core': patch
---

A cached region render is keyed by its region, props, session and page as separate fields, so two visitors whose props and session spell one string another way never share a render (#312).
