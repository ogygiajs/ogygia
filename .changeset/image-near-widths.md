---
'@ogygia/image': patch
---

A responsive image no longer gets a ladder width within a tenth of a width its layout already names (its width, twice it, or the source's own): a 900 px `constrained` image makes 900 and no 960, so a build makes fewer files for the same `srcset` choices.
