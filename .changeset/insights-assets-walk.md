---
'@ogygia/insights': patch
---

The page weight report reads the page's tags as the browser does: a comment ends where the browser ends it, and a tag written inside a `<title>` or `<textarea>` is no asset.
The held-open report reads the page seed from its own script, not from the page facts script beside it.
