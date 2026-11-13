---
'@ogygia/compiler': minor
'ogygia': minor
'@ogygia/data-shake': minor
---

Breaking: shipping only the `page.data` your islands read is a plugin now, `dataShake()` from `@ogygia/data-shake/vite`, listed beside `ogygia()` (`plugins: [ogygia(), dataShake(), sveltekit()]`). Without it every island that reads the page gets all of `page.data`, and every server hole looks the page up.
