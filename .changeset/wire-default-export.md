---
'@ogygia/compiler': patch
---

A wire class exported with `export default` (`export default class Cart`, or `class Cart {}` then `export default Cart`) is now registered, tagged `#default`, and an anonymous `export default class` with a wire codec is the build error `wire_class_anonymous`. Before, the first instance of either to cross into an island threw `transportable_unregistered`.
