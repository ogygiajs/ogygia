---
'@ogygia/core': patch
---

In dev, ogygia checks its own rules after each navigation and machine move (one mount per region, the address bar matches the router's history, nothing of a left page stays open, no failure leaves without a code) and after each response (a request's work ends with it, no shared work keeps a failure), and says a broken one with its code; a production build ships none of them (#313).
