---
'@ogygia/rewrite': patch
---

A reshape transform that throws, or that drops ogygia's `og-h` marks from a host ogygia restores, no longer breaks the page: in production that page or region answer goes out as ogygia rendered it, before the transform, and the failure is logged once as `reshape_pass_failed` or `reshape_marks_lost`; in dev it is thrown with that code, so a broken transform shows at once.
