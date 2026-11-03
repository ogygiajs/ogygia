---
'ogygia': patch
---

`handle({ secret })` signs region capabilities with a secret the app passes (e.g. from `$env/static/private`), for a server that never sees `OGYGIA_SECRET` at runtime; it signs exactly as the same `OGYGIA_SECRET` does, and every copy of ogygia in the process uses it.
