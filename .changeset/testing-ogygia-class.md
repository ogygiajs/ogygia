---
'@ogygia/testing': minor
---

The testing primitives over any driver are a class: `new Ogygia(driver, options)` replaces `createOgygia(driver, options)`, and a driver's own `get`, `post` and `wait` are now called as its methods.
