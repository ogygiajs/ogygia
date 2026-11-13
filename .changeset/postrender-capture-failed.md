---
'@ogygia/postrender': patch
---

A page whose store step fails after postrender read it (a stitched hole whose `endpoint` is not a URL, say) now goes out as rendered, `no-store` and unstored, and the failure is said once per page (`postrender_capture_failed`). The visitor got a response whose body was already read.
