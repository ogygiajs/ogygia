---
'@ogygia/core': patch
'@ogygia/machine': patch
---

core: region links are signed through `capability()`, naming the islands endpoint they are for and refusing a lifetime longer than the app ever mints; links stay identical between renders, and links signed before (pages cached before the upgrade) still work and are re-signed in the new form when renewed
machine: `capability().mintUntil()` mints a token that expires at a given time, so tokens without a nonce stay identical across a window the caller picks
