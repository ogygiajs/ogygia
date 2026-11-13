---
'@ogygia/devtools': patch
---

A report POSTed gzipped to the profiler is inflated under the same 256 MB cap as an uploaded `.ogp`, and refused past it with `devtools_profiler_upload_too_large` (413) instead of being inflated whole.
