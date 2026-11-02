---
"@ogygia/core": patch
---

A region rendered inside a remote `query()` builds its URLs and slot ids without `event.url`, `params` or `route`, which SvelteKit 3 refuses there.
