---
'@ogygia/core': patch
---

A kept region whose next page's props carry a live value the build did not predict now shows those props after the navigation: the runtime loads the wire codec first, instead of silently keeping the old props.
