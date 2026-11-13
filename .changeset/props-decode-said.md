---
'@ogygia/core': patch
---

A hole whose island module throws as it loads, or whose props do not decode, is said in the server's log in production too (`endpoint_props_decode_failed`), not only in dev. The visitor's 403 stays opaque.
