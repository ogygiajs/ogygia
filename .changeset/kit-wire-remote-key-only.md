---
'@ogygia/compiler': patch
---

`ogygia:server/kit-wire` re-exports only SvelteKit's `create_remote_key`, the one helper ogygia uses, which Kit 2 and Kit 3 share; a canary checks it in every installed Kit.
