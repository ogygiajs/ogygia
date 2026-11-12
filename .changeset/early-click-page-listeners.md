---
'@ogygia/core': patch
---

`@ogygia/core`: a click made while an island is starting goes to the island alone; the page's own click listeners hear it once, as the replay when the island is live (late, and with `isTrusted` false), not at the press and then again at the replay.
