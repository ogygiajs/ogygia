---
'@ogygia/compiler': patch
---

An app's Kit config (`kit.files.routes`, `kit.outDir`, `kit.inlineStyleThreshold`) is now held by the plugin that read it, so it can never fall back to the defaults however many apps one process configures.
