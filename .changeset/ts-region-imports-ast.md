---
'@ogygia/compiler': patch
---

A region import in a `.ts` / `.js` module is read from the module's syntax tree: a comment or line break before `with` no longer hides it, and a named, namespace, bare or re-export form with a region key is refused (`region_import_invalid`) instead of passing through as a plain import.
