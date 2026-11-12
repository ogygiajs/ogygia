---
'@ogygia/core': patch
---

A federated app's production runtime now ships what a peer's regions need (the frame store, morph, lakes, wakes), so a peer's `render: 'deferred'` widget loads in an app with no deferred region of its own.
