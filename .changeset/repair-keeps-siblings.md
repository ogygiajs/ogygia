---
'@ogygia/core': patch
---

When a third party puts an element into a sleeping island, the click that wakes it now still counts: the wake keeps every element after the inserted one (custom elements are no longer connected twice), and the replayed click, typed values and focus go to the element itself instead of to whatever now sits at its old position.
