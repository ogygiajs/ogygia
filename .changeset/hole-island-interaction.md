---
'@ogygia/core': patch
---

A hole's island with `wake: 'interaction'` wakes on the visitor's first press or key when the hole's own `when` is another schedule; it used to be armed as the hole's on-demand fetch, which never fired, and stayed server markup for good (#338).
