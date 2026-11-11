---
'@ogygia/router': patch
---

`@ogygia/router`: a route segment with several params (`[a]-[b]-[c]`) matches in time in line with the path, and its earlier params now stop at the next separator (`/x-y-z` on `[a]-[b]` gives `a: 'x'`, `b: 'y-z'`, as SvelteKit does). Paths longer than 8192 characters match no route.
