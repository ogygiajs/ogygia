---
'@ogygia/compiler': patch
---

Seed shaping now ships all of `page.data` when the page is put in an array (other than `derived([…], fn)`'s sources) or a method is called on `page.data` (`page.data.hasOwnProperty('x')`). Before, both were read as a narrower key set, so an island could read `undefined` for a key that was left out of the seed.
