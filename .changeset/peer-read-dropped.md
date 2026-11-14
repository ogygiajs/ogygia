---
'@ogygia/federation': patch
---

A page read from a peer whose fetch a thaw or a mutation drops every time no longer fetches forever: after 16 tries it is a 504, said as the new warning `federation_peer_read_dropped`.
