---
"@ogygia/core": patch
"@ogygia/devtools": patch
"@ogygia/postrender": patch
---

The hook types type-check on SvelteKit 3 too: `Handle` is the library's own (Kit 3 moved Kit's to `@sveltejs/kit/hooks`), so a Kit 3 app no longer sees an untyped `handle` from ogygia, devtools or postrender.
