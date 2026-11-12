---
'@ogygia/core': patch
---

A build now fails with `secret_in_client_chunk` when a client chunk or asset holds a signing secret (`OGYGIA_SECRET`, or the build's own key) or a server module that signs region addresses.
