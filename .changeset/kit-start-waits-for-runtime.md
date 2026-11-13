---
'@ogygia/core': patch
---

On a csr=true page with regions, Kit now starts only after ogygia's runtime is ready, so lakes keep their content when Kit remounts the page; before, a fast Kit start could leave every lake empty. Kit still starts if the runtime fails to load, and a hash-based CSP gets the hash of Kit's changed start script.
