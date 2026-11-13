---
'@ogygia/compiler': patch
---

A `{#snippet}` that crosses into an island now brings along the functions its `use:`, `transition:`, `in:`, `out:` and `animate:` directives name, the values its `style:` directives read, `<svelte:component this={…}>`'s component, and a host name that a `for` loop only shadows. Before, the snippet's entry referenced them undeclared and failed at render.
