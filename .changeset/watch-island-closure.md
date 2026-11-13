---
'@ogygia/compiler': patch
---

A watch rebuild marks every file an island reaches as island code again, so a shared module keeps ogygia's `$app/*` shim on the rebuild too (#1448).
