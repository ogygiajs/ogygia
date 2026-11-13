---
'@ogygia/compiler': patch
---

A wire class whose codec member is typed (`static wire: Codec<Cart> = import.meta.og.wire(…)`) or `readonly` is now found by the build, so it gets its loader and the wire feature; before, it failed to decode in production. A module with only an unrelated computed static, or a wire class it does not export, is no longer imported into every realm.
