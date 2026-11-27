---
'@ogygia/federation': patch
---

A fragment's images load from the app that rendered it: every candidate of a `srcset` and of a preload's `imagesrcset` is pinned to the peer's origin, as are paths under `/__ogygia__/` and image files (`.avif`, `.webp`, `.png`, `.jpg`, `.gif`, `.svg`) named by `src` or `href`. Before, those pointed at the host page's server.
