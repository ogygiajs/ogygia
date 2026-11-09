---
'@ogygia/core': patch
---

A navigation called off before its swap (back pressed, a link to the page on screen) takes the next page's stylesheets it put in the head out again, and stops waiting for them at once, instead of leaving them to style the page on screen (#267).
