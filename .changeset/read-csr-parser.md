---
'@ogygia/compiler': patch
---

A route's `csr` option is now read with a parser, the same way Kit reads it. `export let` / `export var`, a declaration with several declarators, `export { local as csr }` and a parenthesized value now count, and text in a string or comment no longer does. Before, such a page could be taken for the wrong kind: its islands stripped on a `csr = false` page, or the client build predicted wrong.
