---
'@ogygia/federation': patch
---

A server island (or any region with its own endpoint) inside a peer's fragment now shows: the fragment pins its endpoints to its origin, and the shell serves each as a hole of its own that forwards to the peer, instead of asking its own endpoint and getting a 403.
