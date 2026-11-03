---
'@ogygia/core': minor
---

A client-side navigation into a page of another build (a deploy since the page was loaded) loads that page as a document instead of swapping it into the running runtime, so two builds' islands, runtimes and Svelte never meet on one page.
