---
'@ogygia/router': patch
---

A route load that fails runs once per request: the error page no longer runs it again to find the failed layout (its side effects ran twice, and a flaky load that passed the second time put the error page in the wrong layout). A later call to the same load in that request gets the same failure.
