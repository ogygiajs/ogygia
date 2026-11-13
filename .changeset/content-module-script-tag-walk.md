---
'@ogygia/content': patch
---

A content page's module script is found as Svelte reads its tag: one with a `>` inside an attribute value is still the module (no second module script is added), and an instance script whose value only says `module` is not taken for it.
