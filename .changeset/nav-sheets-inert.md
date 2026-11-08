---
'@ogygia/core': patch
---

The next page's stylesheets load inert while a navigation waits, and style the page only once it goes in: a sheet that arrived first no longer styles the page still on screen (#267).
