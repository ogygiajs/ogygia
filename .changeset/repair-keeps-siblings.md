---
'@ogygia/core': patch
---

When a third party puts an element into an island before its server markup, waking the island no longer re-creates every element after it, so the click that wakes the island counts and custom elements are not connected twice.
