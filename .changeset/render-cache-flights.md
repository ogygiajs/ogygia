---
'@ogygia/core': patch
---

A cached hole whose first request leaves while its render waits for a slot keeps its place in the render queue for the requests still waiting on it, instead of being rendered again from the back of the queue; a render every request left never takes a slot.
