---
'@ogygia/core': minor
'ogygia': minor
---

- `@ogygia/core`, `ogygia`: breaking (internal paths only): `ogygia/internal/region-core` is gone, and `ogygia/internal/compiler` no longer exports `set_parser` or takes a `pathModule` option; they existed only to run the compiler in a browser. Import `region` and `isRegion` from `ogygia`. Build output is unchanged.
