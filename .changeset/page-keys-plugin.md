---
'@ogygia/compiler': minor
'ogygia': minor
'@ogygia/page-keys': minor
---

Breaking: seed shaping is a plugin now, `pageKeys()` from `@ogygia/page-keys`, listed beside `ogygia()` (`plugins: [ogygia(), pageKeys(), sveltekit()]`). Add it to keep shipping only the `page.data` keys your islands read; without it every island that reads the page gets all of `page.data`, and every server hole looks it up.
