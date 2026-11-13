---
'@ogygia/core': patch
---

`@ogygia/core`: the `page.data` keys a deferred region's answer brings are no longer lost when an island that woke before the answer hydrates first: they wait for devalue to load, then join the page, so islands inside the region read them.
