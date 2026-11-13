---
'@ogygia/core': patch
---

Dev no longer warns that a nested island's schedule is ignored when it is the same schedule as the island around it (a `wake: 'load'` island inside a `wake: 'load'` island, such as one rendered in a mobile menu sheet).
