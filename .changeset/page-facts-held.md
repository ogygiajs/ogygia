---
'@ogygia/core': patch
---

`@ogygia/core`: a hole or remote-rendered region that reads `page.data` always renders with the facts its page look-up returned. Before, it could silently render with an empty `page.data` when the look-up's answer was not kept.
