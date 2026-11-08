---
'@ogygia/federation': patch
---

The deploy thaw is tried again when its first check fails (the store unreachable, or a peer that never took the notice), instead of being lost until the pages' TTL, and only the peers that missed it are sent it again, for a bounded number of tries (#198).
