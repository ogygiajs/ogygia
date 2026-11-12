---
'@ogygia/core': patch
---

A stylesheet an island's code put in the head as it loaded (the bundler adds the CSS the island's chunks need, as on a mounted peer page) leaves with the page after a router navigation, as a fresh load of the next page has none, and comes back with a page whose island runs that code again.
