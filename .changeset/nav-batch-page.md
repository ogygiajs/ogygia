---
'@ogygia/core': patch
---

`@ogygia/core`: holes that read `page.data` show the data of the page a router navigation leads to, not of the page it left. The navigation's hole batch now names its destination as its referrer.
