---
'@ogygia/core': patch
---

Islands hydrate the component itself instead of through a wrapper component: an island page ships less Svelte (about 0.3–0.4 KB brotli), and a placed island's server markup carries one marker pair fewer.
