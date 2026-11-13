---
'@ogygia/compiler': minor
'ogygia': minor
'@ogygia/data-shake': minor
---

Breaking: seed shaping is a plugin now, `dataShake()` from `@ogygia/data-shake`, listed beside `ogygia()` (`plugins: [ogygia(), dataShake(), sveltekit()]`). Add it to keep shipping only the `page.data` keys your islands read; without it every island that reads the page gets all of `page.data`, and every server hole looks it up.
