---
'@ogygia/core': patch
---

A streamed load promise that never settles no longer holds the server's response open after the visitor leaves: the wait ends with the request and the response closes. A region rendered outside its page now gets a rejected promise (`page_promise_unresolved`) instead of one that stays pending when Kit's data answer ends without its value. Dev warns (`page_promise_pending`) when a streamed promise is still pending after 10 s.
