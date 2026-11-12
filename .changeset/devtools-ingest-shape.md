---
'@ogygia/core': patch
---

On a devtools build, only well-formed server events from the page's devtools side channel enter the event stream, and `ingest()` (a saved trace, another realm) takes only well-formed events of either realm; anything else is left out.
