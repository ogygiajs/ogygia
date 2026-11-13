---
'@ogygia/compiler': patch
---

Seed shaping now covers what a function handed the page reads through an alias of its parameter, a default parameter or `arguments`, and it no longer follows a function binding that is later assigned another function. Before, those keys could be left out of the shipped page seed.
