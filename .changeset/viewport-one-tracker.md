---
'@ogygia/core': patch
---

A region with no box of its own (its content is `position: fixed`, or it is `display: contents`) with a `visible` schedule now wakes, fetches and takes its hydrate turn when what it renders is on screen, as its download's priority already said; it waited for its own empty box before.
