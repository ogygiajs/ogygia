---
"@ogygia/core": patch
---

A markdown route page (`+page.md`) counts in the csr topology like `+page.svelte`, and on a csr=false one Kit's client graph no longer links Region and the island wrappers, which had made every island page ship the Svelte and runtime code they share.
