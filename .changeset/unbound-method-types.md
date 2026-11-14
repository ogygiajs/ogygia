---
'@ogygia/core': patch
'@ogygia/router': patch
'@ogygia/machine': patch
---

`ogygiaTransport()`'s `encode` / `decode`, the router's `handle`, a capability signer's `sign` / `verify` and a stage's `discard` are typed as function properties, so passing one on by itself (`const { handle } = router`) type-checks under `unbound-method`; they never used `this`.
