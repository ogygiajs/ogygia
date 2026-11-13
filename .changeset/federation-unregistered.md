---
'@ogygia/federation': patch
---

A federation request (`/og/frag`, `/og/thaw`, `/og/fragment/*`) that reaches a server before any `federate()` ran there is now said once as `federation_unregistered`, instead of a bare 404 with no word.
