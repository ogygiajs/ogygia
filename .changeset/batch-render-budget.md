---
'@ogygia/core': patch
---

A batch of holes is charged to the visitor's render budget once per hole it renders, after that hole's capability verifies, the same as each hole's own request; one call asked twice in a batch renders once. A hole over budget is left out of the batch and fetches on its own.
