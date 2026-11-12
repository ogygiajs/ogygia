---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

- `@ogygia/core`: a plugin's browser half subscribes to the runtime's moments with `defineClient({ hooks: { … } })` (region mounted, hydrated, failed, hole answered, navigated and the rest); a hook no plugin subscribes to is left out of the runtime, and `regionMount` / `regionUnmount` move inside `hooks`.
- `@ogygia/devtools`: the profiler's beacon is part of devtools' browser half, so an app without devtools no longer carries it in its runtime.
