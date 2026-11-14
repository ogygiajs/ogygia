---
'@ogygia/core': patch
---

In a rolling upgrade from 0.12, a page 0.12 served no longer gets its holes answered by the new release, whose islands its runtime cannot run (the island failed to hydrate). The new server refuses a hole URL minted before capability v3 (`x-ogygia-deny: shape`, on its own, as a renewal and in a batch), so the old page keeps its fallback until it is loaded again.
