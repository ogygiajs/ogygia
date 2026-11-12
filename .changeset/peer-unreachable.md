---
'@ogygia/federation': patch
---

A static widget whose peer gives no answer at all (down, unreachable, or past its timeout) no longer turns the shell's page into a 500: it shows its boundary card, and the failure is said as the new warning `federation_peer_unreachable` (also for a page read, a post and a deferred region, which answer 504).
