---
'@ogygia/compiler': minor
---

An import attribute ogygia does not know on a `.svelte` component import (a misspelling like `wkae`, or the retired `partial`) now fails the build as `region_attribute_unknown`, naming the key and listing the ones the app has; the `partial` attribute's own error is gone. Write `region: 'raw'` for a held component, or `wake: …` for an island. `type` and attributes on other imports are left alone.
