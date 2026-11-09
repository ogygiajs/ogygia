---
'@ogygia/machine': patch
---

In a production build, a step naming a state that does not exist no longer makes `wait()` and `paths()` throw: they skip it, as moves already do (#358).
