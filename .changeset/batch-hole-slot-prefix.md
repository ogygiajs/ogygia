---
'@ogygia/core': patch
---

Holes fetched in one batch (a client-side navigation) mint their slot ids with their own region id, as a hole fetched on its own does. They shared one unprefixed sequence, so a slotted island in a batched hole could take the page's own slot id and adopt the wrong children.
