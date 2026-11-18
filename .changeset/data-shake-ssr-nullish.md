---
'@ogygia/data-shake': patch
---

A `page.data` read under `import.meta.env?.SSR ?? typeof window === 'undefined'` now counts as server-only, as a read under either test alone already did, so it no longer makes every region need the whole page.
