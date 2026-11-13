---
'@ogygia/compiler': patch
---

A dynamic `import()` that names a region key is now refused with `dynamic_region_import` in a `.ts` / `.js` module too, and for the `region` key as well. Before, it was left in place and did nothing.
