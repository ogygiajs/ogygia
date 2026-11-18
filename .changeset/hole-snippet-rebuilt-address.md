---
'@ogygia/core': patch
---

A hole given a snippet prop and rebuilt in the browser (after Kit gives up hydrating) keeps the address the server gave it, instead of warning `hole_without_address` and never loading. Both legs now freeze a snippet to the same HTML: Svelte's server HTML without its hydration markers, which also makes a frozen snippet a little smaller in the page.
