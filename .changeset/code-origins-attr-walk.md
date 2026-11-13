---
'@ogygia/core': patch
---

A runtime script the page emits loses every code-origins attribute it carried, however it is written (single quotes, no quotes, spaces around `=`, twice), so the origins the render learned are the ones the browser reads.
