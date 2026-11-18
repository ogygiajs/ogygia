---
'@ogygia/compiler': patch
---

The `virtual_wrong_realm` build error now names the files that imported the module, nearest first, back to the entry (`` through `src/lib/panel.ts` ← `src/routes/+page.svelte` ``), so the import that broke the build no longer takes a bisect to find.
