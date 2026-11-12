---
'@ogygia/core': patch
---

`@ogygia/core`: island code loads only from the page's origin, the runtime's own, and the origins the server names on the runtime's script (a federation peer's); an `entry` or `src` anywhere else is refused with `island_code_refused`, and a region's `src` re-points only its own island's built file (#851).
