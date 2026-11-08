---
'@ogygia/federation': patch
'@ogygia/postrender': patch
'@ogygia/core': patch
---

A peer whose store fails to apply a thaw notice now answers an error, so the sender sends it again, instead of answering done and deduping the retry; `app.notify` rejects once every hook ran when one failed (#287).
