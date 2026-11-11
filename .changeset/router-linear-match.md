---
'@ogygia/router': patch
---

`@ogygia/router`: a route segment with several params (`[a]-[b]-[c]`) matches in time in line with the path, and splits as SvelteKit's lazy params do (`/x-y-z` on `[a]-[b]` gives `a: 'x'`, `b: 'y-z'`; `/p-q-x-r` on `[a]-x-[b]` gives `a: 'p-q'`, `b: 'r'`). Paths longer than 8192 characters match no route.
