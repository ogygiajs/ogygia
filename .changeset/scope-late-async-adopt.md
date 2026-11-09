---
'@ogygia/machine': patch
---

An async disposable adopted by a scope that already closed is disposed at once and its failure is said (`machine_dispose_failed`), not left unhandled; the closed scope keeps nothing of it (#347).
