---
'@ogygia/core': patch
---

After a client navigation, the next page's head nodes (its `<style>` and stylesheet `<link>` among them) sit in the order a fresh load has them, after the app's global styles, so the cascade is the same however the page was reached.
