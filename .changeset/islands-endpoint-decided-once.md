---
'@ogygia/core': patch
---

The islands endpoint is decided once per server, by the first `handle()` (or the first render when none named one), and never moves: a later `handle()` naming another one, from a second copy of ogygia too, is `islands_endpoint_conflict` (thrown in dev, said in production) and the first path stays, so the pages already minted and the handle that answers them never name two paths and holes no longer come back empty.
