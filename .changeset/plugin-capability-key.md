---
'@ogygia/core': patch
'@ogygia/federation': patch
---

A deferred peer region (and any plugin capability) names the key that signed it, as a region hole does: a server of another deployment (a rolling deploy without one shared OGYGIA_SECRET) refuses it as `foreign-key`, with the advice that goes with it, instead of as a bad signature.
