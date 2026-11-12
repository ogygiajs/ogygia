---
'@ogygia/core': patch
---

An `import.meta.og.$` function now travels as its build tag and captures only, never its source: a side whose build lacks the tag refuses it with `fn_revive_missing` instead of rebuilding it from the payload.
