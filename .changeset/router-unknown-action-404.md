---
'@ogygia/router': patch
---

A form POST naming an action the page does not have (`?/delete` on a page with only `default`) now answers 404, as in Kit. It ran the default action instead.
