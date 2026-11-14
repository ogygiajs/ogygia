---
'@ogygia/core': patch
---

`Region`'s generated `.svelte.d.ts` no longer names `RegionValue`, `Snippet` and `Component` without importing them, so it type-checks with `skipLibCheck` off; its props are unchanged.
