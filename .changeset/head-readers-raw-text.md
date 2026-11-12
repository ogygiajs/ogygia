---
'@ogygia/core': patch
---

`@ogygia/core`: the server's head checks, link dedupe and runtime placement, and the router's prefetch warm read a page the way the browser does: a tag written inside a comment or inside a script's, title's or textarea's text no longer counts, so the runtime is never moved into a commented-out script or a title, a real stylesheet is never dropped as a copy of a commented one, and text that looks like a region no longer makes the router import a module.
