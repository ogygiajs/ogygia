---
"@ogygia/compiler": patch
---

A build no longer names its client chunks by bundler order: a package module both a page and an island import now always reads the `$app/*` shims an island needs, so two builds of the same source write the same client files (no CDN cache churn), and that module no longer sometimes reads Kit's real page state inside an island.
