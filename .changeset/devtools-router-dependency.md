---
"@ogygia/devtools": patch
---

`@ogygia/router` is a dependency of `@ogygia/devtools`, not an optional peer: the profiler's UI is rendered through it, so turning the profiler on no longer needs it installed by hand.
