---
"ogygia": patch
---

Fixed: remote federation holes now share local holes' lifetime and renewal (they died after 5 minutes, so a stored page served dead remote regions); flag sources receive the visitor (a vendor's per-user targeting had no `targetingKey`); a failed peer-cache refresh no longer replaces a good document; the deploy-thaw build marker no longer lapses after a day; a store failure during invalidation is reported as such and no longer stops the edge purge; stored pages age out on read even in a store without expiry; the profiler's shared stores keep a whole recording window (they kept 20 requests); `ogygia site init`'s search page works; `perf --margin 0` is accepted.
