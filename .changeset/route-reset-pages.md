---
'@ogygia/compiler': patch
---

A page or layout with a layout reset (`+page@.svelte`, `+layout@(group).svelte`) is now a route to ogygia, read the way SvelteKit reads it: its csr and its route config come from the layouts it actually renders in, and a dev edit to it refreshes the route answers.
