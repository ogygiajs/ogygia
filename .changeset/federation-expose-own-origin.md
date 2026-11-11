---
'@ogygia/federation': patch
---

`@ogygia/federation`: an exposed route table is always asked on the app's own origin. A fragment request whose `path` does not start with exactly one `/` answers 400, and `search` is always the query.
