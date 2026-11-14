---
'@ogygia/core': minor
---

A bare snippet now freezes through a tiny component (`{@render snippet()}`) rendered by Svelte's public `render()`, instead of a hand-written copy of Svelte's private server component shape. Frozen snippet HTML gains one empty marker (`<!---->`) at its end, so frozen snippets' ids, island fingerprints, freeze keys and ETags change once on upgrade.
