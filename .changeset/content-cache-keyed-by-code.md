---
'@ogygia/content': patch
---

The markdown and code block build cache is keyed by the code that made each entry, not only the package version, so a build with a changed reader no longer serves pages parsed by the old one.
