---
'@ogygia/core': patch
'@ogygia/federation': patch
---

`@ogygia/core`: Reading tags out of server HTML (the head dedupe, region CSS, hole answers, seed injection, stitching) costs 2 to 53% fewer steps: each tag is read once, a character at a time.
`@ogygia/federation`: Lifting a peer page and pinning its asset refs costs about half the steps: one walk, each tag's attributes read once.
