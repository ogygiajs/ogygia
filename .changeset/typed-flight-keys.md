---
'@ogygia/machine': minor
---

`flights<I>()({ key, ignore, run })`: a flights over an object input is keyed by the fields `key` names, spelled one way, and `run` is typed to those fields only, so work that reads a field the key leaves out does not compile unless `ignore` gives the reason; `peek` and `drop` name keys by those fields, and a flights with no `key` is keyed by its whole input (#312).
