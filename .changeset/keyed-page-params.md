---
"ogygia": patch
---

Server router: a page's `load` and `actions` (bare, or through `load()` / `action()`) read `c.params` typed by their table key, as endpoints do, and a `params` or `search` schema now types `c.params` / `c.search` with its output.
