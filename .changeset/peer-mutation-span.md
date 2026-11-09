---
'@ogygia/federation': patch
---

A peer read that starts while a mutation to that peer is out is no longer kept once the mutation ends, so the poster's next read never gets the page from before their own post (#331).
