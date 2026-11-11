---
'@ogygia/core': patch
---

core: the restorer never puts back an event-handler attribute, a `srcdoc` or a `javascript:` URL when it returns a host's attributes to Svelte's
