---
'@ogygia/testing': minor
---

`OgygiaDriver` gains an optional `addInitScript(source)`: `new Ogygia(driver)` hands it the testing engine as it is made, so a custom driver (Puppeteer's `evaluateOnNewDocument`, for one) gets the engine in every page it loads after that. `playwrightDriver` and `withOgygia` use it.
