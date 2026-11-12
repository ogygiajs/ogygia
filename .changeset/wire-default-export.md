---
'@ogygia/compiler': patch
---

A wire class exported with `export default` (`export default class Cart`, or `class Cart {}` then `export default Cart`) is now registered, tagged `#default`. Before, its first instance to cross into an island threw `transportable_unregistered`.
