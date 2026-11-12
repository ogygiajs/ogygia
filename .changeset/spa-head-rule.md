---
'@ogygia/core': patch
---

core: a navigation never adopts a `meta http-equiv="set-cookie"` from a fetched page (beside `<base>` and refresh / CSP metas), and a dev and e2e rule (`rule_head_adopted`) says when the head gains any of them after the first document
