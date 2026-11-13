---
'@ogygia/core': patch
---

A soft refresh (`invalidateAll`) while a navigation waits on the next page's stylesheet no longer takes that sheet out of the head: the navigation goes in as soon as the sheet loads, styled, instead of after the full 2 s wait and unstyled.
