---
'@ogygia/compiler': patch
---

Region stylesheets are now compiled with the app's own Svelte compiler options (as vite-plugin-svelte resolved them), so an app with a custom `cssHash` (or `rootDir`) gets server region and router page CSS whose class names match the markup instead of rules that style nothing.
