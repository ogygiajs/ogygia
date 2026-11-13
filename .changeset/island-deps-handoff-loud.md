---
'@ogygia/core': patch
'@ogygia/compiler': patch
---

A production server that cannot find or read the client build's handoff (`og-region-deps.json`) now says so (`island_deps_handoff_missing`, with the paths it tried) instead of rendering every hole without its CSS and preloads in silence. A handoff that failed to read or parse is tried again on the next request instead of being replaced by an empty one for the life of the process.
