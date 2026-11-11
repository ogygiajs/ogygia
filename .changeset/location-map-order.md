---
'@ogygia/core': patch
---

Two builds of the same code write the same `og-locations` map under the same name, so a deploy with no island change no longer busts its cache.
