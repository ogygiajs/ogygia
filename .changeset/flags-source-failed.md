---
'@ogygia/flags': patch
---

A flag source that fails (a throwing source, an OFREP endpoint that errors or cannot be reached, an OpenFeature flag whose evaluation throws) now prints `flags_source_failed` once per failing streak, instead of falling back to the native rule without a word.
