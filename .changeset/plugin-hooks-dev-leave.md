---
'@ogygia/core': patch
---

A dev edit that runs a plugin's server half again no longer leaves its old run in the shared hooks: the plugins of the run before leave first, so `notify` reaches only the current ones and `ask` answers from them (#251).
