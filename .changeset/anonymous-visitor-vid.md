---
'@ogygia/router': minor
'@ogygia/flags': minor
---

`@ogygia/router`, `@ogygia/flags`: **Breaking:** `anonymousVisitor()` returns `{ vid, anonymous: true }` and never fills `sub`, which stays a signed-in user's id (so `mount()` never signs a cookie value onward as one). Flags hash on `sub`, else `vid` (an anonymous visitor keeps its bucket), the `og-vid` cookie reaches a source as `{ vid, anonymous: true }`, and the default `openfeature()` / `ofrep()` context sends `vid` as `targetingKey` when there is no `sub`. Code that read `c.visitor.sub` for anonymous visitors reads `c.visitor.vid`; exposure events from them arrive without a `sub`.
