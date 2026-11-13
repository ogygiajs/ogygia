---
'@ogygia/reshape': patch
---

A restored host whose `og-shadow` names a sheet the page does not carry is no longer skipped silently: the page says `restore_sheet_missing` once per key, and the other sheets it names still apply.
