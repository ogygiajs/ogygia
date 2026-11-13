---
'@ogygia/federation': patch
---

A mounted peer page no longer carries its `ogygia-*` metas into the shell's head: the peer's router meta turned on the client router in a shell built with `router: false`, and overrode a shell's own view-transition setting.
