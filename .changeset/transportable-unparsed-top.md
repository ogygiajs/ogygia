---
'@ogygia/compiler': patch
---

A source file the build's first scan cannot parse is now treated as one that may define a wire class, so a wire class in it keeps its loader and the wire feature; before, it could fail to decode on the client with no message.
