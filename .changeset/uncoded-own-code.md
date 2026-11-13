---
'@ogygia/core': patch
---

In dev and rules builds, a plain error thrown in ogygia's own code that nothing caught (a TypeError, say) now breaks `rule_failure_uncoded`, not only an `[ogygia]` message with no code.
