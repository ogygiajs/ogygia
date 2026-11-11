---
'@ogygia/machine': patch
---

`observe()` keeps its watchers in a registry: each leaves with its stop, and the rest hear moves in the order they started watching.
