---
'@ogygia/machine': minor
---

`scope()`: one owner for listeners, timers, observers, tasks, child scopes and cleanups, all let go together and exactly once on `close()`; each visit of a machine to a state is one (`m.scope`), in place of `task()` and `onLeave()`.
