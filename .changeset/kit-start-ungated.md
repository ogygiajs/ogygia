---
'@ogygia/core': patch
---

In dev, a csr=true page whose SvelteKit start script ogygia cannot hold until its runtime booted now warns (`kit_start_ungated`) instead of letting Kit start first without a word.
