---
'@ogygia/machine': patch
---

A scope's `{ once: true }` listener lets go of itself when it fires, as a fired timer does, so a long-lived scope no longer piles them up (#348).
