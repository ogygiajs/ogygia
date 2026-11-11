---
'@ogygia/core': patch
---

An import of a `virtual:ogygia/…` module that does not exist now fails with the `virtual_unknown` message, instead of an unresolved-import error from the bundler.
