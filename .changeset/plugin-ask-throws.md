---
'@ogygia/core': patch
---

A plugin's shared `ask` hook throws when no implementation answered and one threw, instead of answering `undefined` as if nobody knew (#198).
