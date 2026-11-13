---
'@ogygia/core': patch
---

A streamed `page.data` promise the page never resolved rejects with ogygia's coded error (`code: 'page_promise_unresolved'`), not a plain copy of its message.
