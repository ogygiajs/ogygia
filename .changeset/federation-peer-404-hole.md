---
'@ogygia/federation': patch
---

A peer page that is not found is now handled one way: it is a 404 wherever the shell still sets the status, and a slot that can't change its status keeps its fallback. A deferred page hole now answers 404 and keeps its fallback (it used to answer 200 and put the peer's not-found page in the region). A streamed `mount({ stream })` now shows the "temporarily unavailable" card (it used to put the peer's not-found page inside the 200). `mount()` and `mount.kit()` still answer 404, as before. A peer page that moves with a status that is not a redirect (such as 304) is now refused as a bad answer (a 502, `federation_peer_answer_invalid`) instead of being passed on as a redirect.
