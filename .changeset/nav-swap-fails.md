---
'@ogygia/core': patch
---

A navigation whose swap throws (with or without a view transition), or whose devalue fails to load, now ends and goes to the browser with its error said, instead of staying in flight or finishing as if the page went in (#276).
