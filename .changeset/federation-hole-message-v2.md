---
'@ogygia/federation': patch
---

`@ogygia/federation`: a deferred remote hole's signature now covers its peer, kind, target and search as separate fields (message version 2). A hole URL minted before the update is refused like any other bad signature; pages rendered after the update carry new ones.
