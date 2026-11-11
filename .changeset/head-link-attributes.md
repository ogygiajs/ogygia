---
'@ogygia/core': patch
'ogygia': patch
---

The head's duplicate-link pass reads each `<link>` attribute as HTML does, so a stylesheet or preload hint whose URL has an apostrophe is no longer dropped, and `data-rel` / `data-href` no longer count as `rel` / `href`.
