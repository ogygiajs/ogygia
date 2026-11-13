---
'@ogygia/compiler': patch
---

A region preset takes the standard keys (`render`, `wake`, `fetch`, …) when the app renames its import keys, as the docs say; before, a preset with `render` failed the build under `importKeys: { render: 'mode' }`, and the unknown-key message left out `keep`.
