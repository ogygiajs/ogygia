---
'@ogygia/core': patch
---

A region kept across a client navigation (`keep: 'name'`) now carries the next page's `data-og-fp` along with its props, so its props sidecar is found and the router lists the islands the page really holds.
