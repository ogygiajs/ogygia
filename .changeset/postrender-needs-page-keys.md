---
'@ogygia/postrender': minor
'@ogygia/compiler': minor
---

Breaking: `postrender()` requires `pageKeys()`. Add `import { pageKeys } from '@ogygia/page-keys'` and list `pageKeys()` beside `postrender()`. Without it the build fails with `plugin_needs_plugin`, because every deferred region would look the page up and render the stored page again.
