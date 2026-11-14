---
'@ogygia/core': minor
'@ogygia/router': minor
'@ogygia/machine': minor
---

These methods are now typed as function properties, so passing one on by itself (`const { handle } = router`) type-checks under `unbound-method`; none of them used `this`. A method type was bivariant in its parameters and a function property is checked strictly, so code that assigned a narrower function to one of them may now need its parameter types widened. The changed types: `ogygiaTransport.Region.encode` / `.decode` and the ref entry's `encode` / `decode` (`@ogygia/core`), `CapabilitySigner.sign` / `.verify` (`@ogygia/core`), `Router.handle` (`@ogygia/router`), `Signer.sign` / `.verify` and `Staging.discard` (`@ogygia/machine`).
