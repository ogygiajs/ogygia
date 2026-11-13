---
'@ogygia/compiler': patch
---

In dev, every route file Kit reads counts when it is added, edited or removed (a `+page.md` page too, not only `.svelte`/`.js`/`.ts`), and an edit that changes no route's options (a page's body, a comment in `+layout.ts`) no longer reloads the route modules (#1495).
