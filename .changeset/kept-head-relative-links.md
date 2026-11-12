---
'@ogygia/core': patch
---

A head link the router keeps across a client navigation to a deeper or shallower path still names its file: the router reads each page-relative head URL (Kit's default `../_app/...`) against the address its page wrote it for and leaves loaded links as they are; only a parked (disabled) sheet, not fetched yet, is made root-relative before the address moves.
