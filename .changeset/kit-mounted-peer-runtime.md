---
'@ogygia/core': patch
---

On an app with no router, a page that shows a mounted peer page's islands (a `mount.kit` catchall) loads the runtime, so those islands wake: no runtime was shipped when the page rendered no region of its own.
