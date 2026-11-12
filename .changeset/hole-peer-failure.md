---
'@ogygia/federation': patch
---

A deferred peer region whose peer fails (an error status, a cut or malformed body, or no answer) no longer answers its hole as an empty success: the hole answers 502, 503 or 504, so the region keeps its fallback and the browser asks again.
