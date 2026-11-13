---
'@ogygia/core': patch
---

In dev and rules builds, a batch of holes where one hole skips its page's data and another asks for it no longer breaks `rule_hole_page_read_unpredicted` when the page's data could not be looked up.
