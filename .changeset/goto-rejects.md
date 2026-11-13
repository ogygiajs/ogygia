---
'@ogygia/core': patch
---

`goto()` returns a rejected promise for a URL it refuses (not http, another origin without `external`, unparsable) instead of throwing, as Kit's `goto` does: `goto(x).catch(...)` now sees it. A `try { goto(x) } catch` without `await` no longer catches it.
