---
"@ogygia/core": patch
---

The compiler's import walks (island closure, region CSS, router CSS, `og.bake`) follow package.json `#…` subpath imports such as Kit's `#lib` through one resolver.
