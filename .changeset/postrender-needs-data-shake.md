---
'@ogygia/postrender': minor
'@ogygia/compiler': minor
---

Breaking: `postrender()` requires `dataShake()`. Add `import { dataShake } from '@ogygia/data-shake'` and list `dataShake()` beside `postrender()`. Without it the build fails with `plugin_needs_plugin`, because every deferred region would look the page up and render the stored page again.
