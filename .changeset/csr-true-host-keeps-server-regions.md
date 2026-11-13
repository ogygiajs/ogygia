---
'@ogygia/compiler': patch
---

A deferred hole, a lake, a live region or a held region written directly in a csr=true `+page.svelte` or `+layout.svelte` now stays a real region, as the same import already did in a shared component. Before, it became a plain component: the hole rendered inline in the page's SSR and the lake was hydrated by Kit. Wake islands in a csr=true route file are still plain components Kit hydrates.
