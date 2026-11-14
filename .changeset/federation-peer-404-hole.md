---
'@ogygia/federation': patch
---

A deferred page hole whose peer page is not found now answers 404 and keeps its fallback. It used to answer 200 and put the peer's not-found page in the region. A peer page that moves with a status that is not a redirect (such as 304) is now refused as a bad answer (a 502, `federation_peer_answer_invalid`) instead of being passed on as a redirect.
