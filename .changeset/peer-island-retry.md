---
'@ogygia/core': patch
---

A peer's island (fragment federation) whose code download fails once is asked for again under a fresh URL, like the app's own islands, instead of never loading. A retry goes only to the origin the island's file was first asked from.
