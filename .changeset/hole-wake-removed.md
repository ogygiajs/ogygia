---
'@ogygia/compiler': minor
---

`wake` on a `render: 'deferred'` import or preset, deprecated in 0.13, now fails the build (`hole_wake_removed`): a deferred region ships no JS, so `wake` never applies. Write its timing as `fetch`: `with { render: 'deferred', fetch: 'visible' }`.
