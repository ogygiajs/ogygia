---
'@ogygia/compiler': minor
'@ogygia/core': minor
---

A named import takes the region mark, in `.svelte`, `.ts` and `.js`, and replaces `import.meta.og.asRegion`, which is now a build error (`as_region_removed`) that prints the import to write. Before: `import { Search } from '@ogygia/content'; const SearchBox = import.meta.og.asRegion(Search, { wake: 'idle' });` After: `import { Search as SearchBox } from '@ogygia/content' with { wake: 'idle' };`. One `with` covers every name in its import; a marked name used as anything but a component, and a mark on a namespace, type-only or bare import, fail the build with a code.
