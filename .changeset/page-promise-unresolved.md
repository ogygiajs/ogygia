---
'@ogygia/core': patch
---

A streamed `page.data` promise in an island no longer waits forever when its value can no longer come: once the page has loaded with no value for it, or its value came but the code to read it never downloaded, it is rejected with `page_promise_unresolved` and `{#await}` shows its catch branch.
