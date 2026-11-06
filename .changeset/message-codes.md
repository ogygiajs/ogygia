---
'@ogygia/core': minor
'@ogygia/content': patch
'@ogygia/devtools': patch
'@ogygia/federation': patch
'@ogygia/flags': patch
'@ogygia/postrender': patch
'@ogygia/testing': patch
'@ogygia/cli': patch
---

Every ogygia error and warning has a code and a page at `ogygiajs.dev/e/<code>`: dev prints the wording and the link, a production build prints the link alone (`[ogygia] https://ogygiajs.dev/e/<code>?<args>`), so the wording stays out of the client and server bundles.
