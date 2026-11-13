---
'@ogygia/devtools': patch
---

`@ogygia/testing`'s `record()` keeps one session across a full page load in WebKit (Safari): the testing engine no longer throws on the new page when it picks up the session the old page saved.
