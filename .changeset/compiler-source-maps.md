---
'@ogygia/compiler': patch
---

A module the compiler rewrites in several passes (a macro, the island transform, the module-script registrations, the client `$app/*` shim, the server's ownership stamps) now carries a source map back to the file as written, so stack traces and breakpoints land on the right line and column. A text-only plugin macro leaves a map with no positions rather than wrong ones.
