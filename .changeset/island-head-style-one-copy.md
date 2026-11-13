---
'@ogygia/core': patch
---

A `<style>` written over several lines in an island's `<svelte:head>` is one copy once the island wakes: the page's server copy is retired, as it is for single-line head content.
