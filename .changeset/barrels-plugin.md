---
'@ogygia/core': major
'ogygia': major
'@ogygia/barrels': major
---

The barrel rewrite is a plugin now, `barrels()` from `@ogygia/barrels`, listed beside `ogygia()` (`plugins: [ogygia(), barrels(), sveltekit()]`) with the same options. `ogygia({ barrels })` is a build error (`barrels_option_removed`) that names it, and `debarrel()`, `DebarrelOptions` and `DebarrelMatcher` are gone from `ogygia/vite`.
