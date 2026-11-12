---
'@ogygia/federation': patch
---

A static widget whose peer answers an error status (4xx or 5xx) no longer turns the shell's page into a 500: it shows its boundary card, the answer is said as `federation_peer_answer_invalid`, and a page read or a post passes the peer's own 503 or 504 through (any other error status is still a 502).
