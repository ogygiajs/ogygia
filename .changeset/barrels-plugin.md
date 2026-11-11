---
'@ogygia/core': minor
'ogygia': minor
'@ogygia/barrels': minor
---

Breaking: the barrel rewrite is a plugin now, `barrels()` from `@ogygia/barrels`, listed beside `ogygia()` (`plugins: [ogygia(), barrels(), sveltekit()]`) with the same options. Use it in place of `ogygia({ barrels })`, which is a build error (`barrels_option_removed`) that names it; `debarrel()`, `DebarrelOptions` and `DebarrelMatcher` are gone from `ogygia/vite`.
