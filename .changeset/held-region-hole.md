---
'@ogygia/core': patch
---

A server island (`render: 'deferred'`) inside a held region that wakes now shows: the region's HTML is rendered the way its component hydrates, so the server island renders inline as it does inside any island, instead of an empty element that was never fetched.
