---
'@ogygia/machine': patch
---

`@ogygia/machine`: in production, a `slot()` asked for at a version other than the one held keeps one private value for that version, made once. It made a new value on every ask, so state kept in it was lost.
