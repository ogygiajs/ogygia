---
'@ogygia/machine': minor
---

A wait gives `STALE` when anything it waited on is stale: `scope.task`, a mailbox's waits and `ask`, a flights run and `stage().ready` turn `STALE` or an array with `STALE` in it (a `Promise.all` with a stale part) into `STALE`, and `Fresh<T>` types the slots after the check (#378).
