---
'@ogygia/core': patch
---

Two lakes of the same component with different props each keep their own content when Kit remounts a csr=true page; before, the second showed the first one's HTML and lost its own islands.
