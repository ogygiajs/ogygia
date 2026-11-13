---
'@ogygia/compiler': patch
---

On Kit 2 without `OGYGIA_SECRET`, the build's check that no browser file holds the signing key now looks for the key the server bundle really uses (before, it looked for a key nothing used, so that half of the check never fired) (#1412).
