---
'@ogygia/core': patch
'@ogygia/compiler': patch
---

An island whose props carry a live value the build did not predict (a forwarded `children`, a snippet passed as a prop, a spread of `$props()`) now hydrates: the runtime loads the wire codec when that island wakes, instead of failing with "wired prop but no wire feature". Builds that already ship the codec are unchanged.
