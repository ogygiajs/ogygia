---
'@ogygia/compiler': patch
---

An `import.meta.og.*` call after a regex that follows a keyword (`return /'/.test(s)`) or an `if (…)`, or inside a template's `${…}`, is found and rewritten: the macro scanner lost its place there and left the call in the module.
