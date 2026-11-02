---
"@ogygia/core": patch
---

Custom `transport` types reach the island page seed, the remote seed and a hole's page facts again on SvelteKit 3: ogygia reads the encoders from the app's hooks, not from Kit's request state (Kit 3 keeps none there).
