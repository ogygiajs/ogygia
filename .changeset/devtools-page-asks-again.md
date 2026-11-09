---
'@ogygia/devtools': patch
---

The devtools Page tab asks the dev server for a file's `Vary` header and for the pre-bundled packages again after a failed ask, instead of hiding those findings for the rest of the session (#363).
