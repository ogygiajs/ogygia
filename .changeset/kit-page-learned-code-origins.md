---
'@ogygia/core': patch
---

A Kit page's runtime script names the code origins its render learned (a mounted peer page whose runtime is served from another origin): they were dropped, because Kit runs the page transform outside its request store.
