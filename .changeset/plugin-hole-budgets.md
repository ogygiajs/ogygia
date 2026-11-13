---
'@ogygia/core': patch
'@ogygia/federation': patch
---

A plugin's signed hole (federation's `/og/frag`) now pays the visitor's region rate budgets as a region hole does: the probe budget before the signature check, the render budget after. A federation hole can now answer 429 with Retry-After under load.
