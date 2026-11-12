---
'@ogygia/devtools': patch
---

The profiler stops unpacking an uploaded `.ogp` past 256 MB and refuses it with `devtools_profiler_upload_too_large` (413), instead of unpacking any size.
